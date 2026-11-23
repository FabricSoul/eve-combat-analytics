import { DurableObject } from 'cloudflare:workers'
import { GamelogFormatError } from '../core/contract'
import type {
  Affiliation, ApiError, BattleMeta, FitEntry, NameIndex, ServerMessage, UploadedLog, UploadedLogSummary,
} from '../core/contract'
import { ApiFailure, battlePath, errorResponse, readLog, upstreamFailure } from './http'
import type { Env } from './index'
import { createServices } from './services'
import type { Services } from './services'
import { BattleStorage, compressLog } from './storage'

function sideOf(affiliation: Affiliation | undefined, teams: BattleMeta['teams']): number {
  if (!affiliation) return -1
  const { allyId, corpId } = affiliation
  const allianceSide = allyId === null ? -1 : teams.findIndex((team) => team.includes(`ally:${allyId}`))
  return allianceSide >= 0 ? allianceSide : teams.findIndex((team) => team.includes(`corp:${corpId}`))
}

function characterId(ids: Record<string, number | null>, name: string): number | null {
  return Object.hasOwn(ids, name) ? ids[name] ?? null : null
}

function logSummary(
  { id, charId, charName, side, events }: Omit<UploadedLogSummary, 'replaced'>,
  replaced: boolean,
): Response {
  return Response.json({ id, charId, charName, side, events, replaced } satisfies UploadedLogSummary)
}

export class BattleRoom extends DurableObject<Env> {
  private readonly store: BattleStorage
  private serviceInstance?: Services
  private tail: Promise<void> = Promise.resolve()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    this.store = new BattleStorage(ctx.storage)
  }

  protected makeServices(): Services {
    return createServices(this.env)
  }

  private get services(): Services {
    return this.serviceInstance ??= this.makeServices()
  }

  // Serialize writes with WebSocket setup so the snapshot always precedes subsequent updates.
  private async inOrder<T>(action: () => Promise<T> | T): Promise<T> {
    const previous = this.tail
    let next!: () => void
    this.tail = new Promise<void>((resolve) => { next = resolve })
    await previous
    try {
      return await action()
    } finally {
      next()
    }
  }

  async create(brId: string): Promise<{ brId: string } | ApiError> {
    return this.inOrder(async () => {
      if (!this.store.meta()) {
        let meta: BattleMeta
        const services = this.services
        try {
          meta = await services.fetchBattleMeta(brId)
        } catch (error) {
          const failure = upstreamFailure(error)
          return { error: failure.code, message: failure.message }
        }
        this.store.setMeta(meta)
      }
      return { brId }
    })
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      const meta = this.store.meta()
      if (!meta) throw new ApiFailure('br_not_found', 'Battle has not been created')
      const route = battlePath.exec(new URL(request.url).pathname)?.[2] ?? ''
      if (request.method === 'GET' && !route) return Response.json(await this.store.state(meta))
      if (request.method === 'POST' && route === 'logs') {
        const text = await readLog(request)
        return await this.inOrder(() => this.upload(meta, text))
      }
      if (request.method === 'PUT' && route.startsWith('fits/')) {
        const charIdText = route.slice('fits/'.length)
        const charId = Number(charIdText)
        if (!/^\d+$/.test(charIdText) || !Number.isSafeInteger(charId) || charId <= 0) {
          throw new ApiFailure('br_not_found', 'Invalid character ID')
        }
        const eft = await request.text()
        return await this.inOrder(() => this.setFit(charId, eft))
      }
      if (request.method === 'GET' && route === 'ws') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          throw new ApiFailure('br_unavailable', 'WebSocket upgrade required', 426)
        }
        return await this.inOrder(() => this.openWebSocket(meta))
      }
      throw new ApiFailure('br_not_found', 'Battle API route not found')
    } catch (error) {
      return errorResponse(error)
    }
  }

  private async upload(meta: BattleMeta, text: string): Promise<Response> {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    const id = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
    const existing = this.store.logById(id)
    if (existing) return logSummary(existing, false)

    const services = this.services
    let parsed
    try {
      parsed = services.parseGamelog(text)
    } catch (error) {
      if (error instanceof GamelogFormatError) throw new ApiFailure('not_a_gamelog', error.message)
      throw error
    }
    const events = parsed.events.filter(({ t }) => meta.windows.some(({ start, end }) => start <= t && t <= end))
    if (!events.length) throw new ApiFailure('no_overlap', 'No log events fall within the battle windows')

    const charName = parsed.listener
    const charId = characterId(await services.namesToCharacters([charName]), charName)
    if (charId === null) throw new ApiFailure('unknown_character', 'Could not resolve the Gamelog listener')
    const affiliations = await services.affiliations([charId])
    const side = sideOf(affiliations.find((entry) => entry.charId === charId), meta.teams)
    const displayNames = [...new Set(events.map(({ other }) => other.name || other.raw))]
      .filter((name) => name && !this.store.hasName(name))
    const names = await this.resolveNames(displayNames, meta.teams)

    const log: UploadedLog = { id, charId, charName, side, uploadedAt: services.now(), parsed: { ...parsed, events } }
    const compressed = await compressLog(log.parsed)
    const replaced = this.store.saveLog(log, compressed, names)
    this.broadcast({ type: 'log_added', log, names })
    return logSummary({ ...log, events: events.length }, replaced)
  }

  private async resolveNames(names: string[], teams: BattleMeta['teams']): Promise<NameIndex> {
    if (!names.length) return {}
    const ids = await this.services.namesToCharacters(names)
    const charIds = [...new Set(names.map((name) => characterId(ids, name)))].filter((id) => id !== null)
    const affiliations = charIds.length ? await this.services.affiliations(charIds) : []
    const byId = new Map(affiliations.map((entry) => [entry.charId, entry]))
    return Object.fromEntries(names.map((name) => {
      const charId = characterId(ids, name)
      return [name, charId === null ? null : { charId, side: sideOf(byId.get(charId), teams) }]
    }))
  }

  private setFit(charId: number, eft: string): Response {
    const header = eft.split(/\r\n|\n|\r/, 1)[0]?.trim() ?? ''
    const fields = /^\[([^,\[\]]+),(.+)\]$/.exec(header)
    if (!fields?.[1]?.trim() || !fields[2]?.trim()) {
      throw new ApiFailure('bad_eft', 'The first line of an EFT fit must be [Ship, Name]')
    }
    const fit: FitEntry = { charId, eft, setAt: this.services.now() }
    this.store.setFit(fit)
    this.broadcast({ type: 'fit_set', fit })
    return Response.json(fit)
  }

  private async openWebSocket(meta: BattleMeta): Promise<Response> {
    const snapshot: ServerMessage = { type: 'snapshot', state: await this.store.state(meta) }
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)
    server.send(JSON.stringify(snapshot))
    return new Response(null, { status: 101, webSocket: client })
  }

  override webSocketMessage(): void {
    // The public protocol sends updates from the server only.
  }

  override webSocketClose(ws: WebSocket, code: number, reason: string): void {
    if (code === 1006 || ws.readyState === WebSocket.CLOSED) return
    if (code >= 1000 && code < 5000 && ![1004, 1005, 1015].includes(code)) ws.close(code, reason)
    else ws.close()
  }

  private broadcast(message: ServerMessage): void {
    const sockets = this.ctx.getWebSockets()
    if (!sockets.length) return
    const text = JSON.stringify(message)
    for (const socket of sockets) {
      try {
        socket.send(text)
      } catch {
        // A disconnected viewer does not prevent other viewers from receiving the update.
      }
    }
  }
}
