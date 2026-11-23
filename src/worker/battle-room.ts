import { DurableObject } from 'cloudflare:workers'
import { analyze } from '../core/analysis/analyze'
import { sideOf } from '../core/br/normalize'
import { GamelogFormatError } from '../core/contract'
import type {
  Analysis, ApiError, BattleMeta, FitEntry, LogEvent, NameIndex, ServerMessage, UploadedLogSummary,
} from '../core/contract'
import { analysisJson } from './analysis-json'
import { ApiFailure, battlePath, errorResponse, readText, upstreamFailure } from './http'
import type { Env } from './index'
import { abortable, createServices } from './services'
import type { Services } from './services'
import { BattleStorage, packJson, packStream } from './storage'
import type { StoredLog } from './storage'

const NAME_LIMIT = 2000
const ESI_NAME_BATCH = 500
const SOCKET_LIMIT = 1024 * 1024
const encoder = new TextEncoder()

function characterId(ids: Record<string, number | null>, name: string): number | null {
  return Object.hasOwn(ids, name) ? ids[name] ?? null : null
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))))
}

function historicalSides(meta: BattleMeta): Map<number, number> {
  const sides = new Map<number, number>()
  for (const { victim, attackers } of meta.killmails) {
    for (const p of [victim, ...attackers]) {
      if (p.charId !== null && (sides.get(p.charId) ?? -1) < 0) {
        sides.set(p.charId, sideOf(p, meta.teams))
      }
    }
  }
  return sides
}

type Battle = { meta: BattleMeta; sides: Map<number, number> }

type AnalysisRead =
  | { status: 404 }
  | { status: 503 }
  | { status: 304; etag: string }
  | { status: 200; etag: string; body: ReadableStream<Uint8Array<ArrayBuffer>> }

export class BattleRoom extends DurableObject<Env> {
  protected readonly uploadEsiTimeoutMs: number = 15_000
  protected readonly analysisDelayMs: number = 2_000
  private readonly store: BattleStorage
  private serviceInstance?: Services
  private battleCache?: Battle
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

  private async battle(): Promise<Battle> {
    if (this.battleCache) return this.battleCache
    const meta = await this.store.meta()
    return this.battleCache ??= { meta, sides: historicalSides(meta) }
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
      if (this.store.exists()) {
        await this.store.migrateIfNeeded((await this.battle()).meta)
        return { brId }
      }
      let meta: BattleMeta
      try {
        meta = await this.services.fetchBattleMeta(brId)
      } catch (error) {
        const failure = upstreamFailure(error)
        return { error: failure.code, message: failure.message }
      }
      const chunks = await packJson(meta)
      await this.scheduleAnalysis()
      this.store.initialize(chunks)
      return { brId }
    })
  }

  override async fetch(request: Request): Promise<Response> {
    try {
      if (!this.store.exists()) throw new ApiFailure('br_not_found', 'Battle has not been created')
      const route = battlePath.exec(new URL(request.url).pathname)?.[2] ?? ''
      if (request.method === 'GET' && !route) {
        return Response.json(this.store.summary((await this.battle()).meta))
      }
      if (request.method === 'GET' && route.startsWith('logs/')) {
        const id = route.slice('logs/'.length)
        if (!/^[a-f0-9]{64}$/.test(id)) throw new ApiFailure('bad_request', 'Invalid log ID')
        const log = await this.store.logDetail(id)
        if (!log) throw new ApiFailure('br_not_found', 'Log has not been uploaded to this battle')
        return Response.json(log, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } })
      }
      if (request.method === 'POST' && route === 'logs') {
        const text = await readText(request, 10 * 1024 * 1024, 'Gamelogs must be at most 10 MiB')
        const id = await sha256(text)
        return await this.inOrder(() => this.upload(id, text))
      }
      if (request.method === 'PUT' && route.startsWith('fits/')) {
        const charIdText = route.slice('fits/'.length)
        const charId = Number(charIdText)
        if (!/^\d+$/.test(charIdText) || !Number.isSafeInteger(charId) || charId <= 0) {
          throw new ApiFailure('bad_request', 'Invalid character ID')
        }
        const eft = await readText(request, 64 * 1024, 'EFT fits must be at most 64 KiB')
        return await this.inOrder(() => this.setFit(charId, eft))
      }
      if (request.method === 'GET' && route === 'ws') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          throw new ApiFailure('bad_request', 'WebSocket upgrade required', 426)
        }
        return await this.inOrder(async () => this.openWebSocket((await this.battle()).meta))
      }
      throw new ApiFailure('br_not_found', 'Battle API route not found')
    } catch (error) {
      return errorResponse(error)
    }
  }

  private scheduleAnalysis(): Promise<void> {
    return this.ctx.storage.setAlarm(Date.now() + this.analysisDelayMs)
  }

  override async alarm(): Promise<void> {
    if (!this.store.exists()) return
    const { revision, analyzedRevision } = this.store.analysisStatus()
    if (revision === analyzedRevision) return

    const analysis = await this.analyzeRevision(revision)
    if (!analysis) return
    const chunks = await packStream(analysisJson(analysis))
    const version = this.store.publishAnalysis(revision, chunks)
    if (version !== undefined) this.broadcast({ type: 'analysis_ready', version })
  }

  private async analyzeRevision(revision: number): Promise<Analysis | undefined> {
    const state = await this.store.state((await this.battle()).meta)
    // An upload can commit while logs are being read. Its alarm will take a fresh snapshot.
    if (this.store.analysisStatus().revision === revision) return analyze(state)
  }

  // RPC keeps the stored bytes compressed across the DO-to-Worker hop.
  async readAnalysis(ifNoneMatch: string | null): Promise<AnalysisRead> {
    if (!this.store.exists()) return { status: 404 }
    const status = this.store.analysisStatus()
    if (status.revision !== status.analyzedRevision && await this.ctx.storage.getAlarm() === null) {
      // Rooms created by older versions can build their first result without changing battle data.
      await this.scheduleAnalysis()
    }
    // Read the version and its chunks together, after any scheduling awaits.
    const { version } = this.store.analysisStatus()
    if (version === 0) return { status: 503 }

    const etag = `"v${version}"`
    const matches = ifNoneMatch?.split(',').some((value) => {
      const candidate = value.trim()
      return candidate === '*' || candidate.replace(/^W\//, '') === etag
    })
    if (matches) return { status: 304, etag }
    return { status: 200, etag, body: new Blob(this.store.analysisChunks()).stream() }
  }

  private async upload(id: string, text: string): Promise<Response> {
    const existing = this.store.logById(id)
    if (existing) return Response.json(existing)

    const battle = await this.battle()
    let parsed
    try {
      parsed = this.services.parseGamelog(text)
    } catch (error) {
      if (error instanceof GamelogFormatError) throw new ApiFailure('not_a_gamelog', error.message)
      throw error
    }
    const events = parsed.events.filter(({ t }) => battle.meta.windows.some(({ start, end }) => start <= t && t <= end))
    if (!events.length) throw new ApiFailure('no_overlap', 'No log events fall within the battle windows')

    await this.store.migrateIfNeeded(battle.meta)
    const budget = new AbortController()
    const timeout = setTimeout(() => budget.abort(), this.uploadEsiTimeoutMs)
    const signal = budget.signal
    const charName = parsed.listener
    try {
      const ids = await this.lookupListener(charName, signal)
      const charId = characterId(ids, charName)
      if (charId === null) throw new ApiFailure('unknown_character', 'Could not resolve the Gamelog listener')
      const side = await this.listenerSide(charId, battle, signal)
      const resolution = await this.resolveNames(events, battle, signal)
      // No more ESI calls are needed after this point.
      clearTimeout(timeout)

      const log: StoredLog = {
        id, charId, charName, side, uploadedAt: this.services.now(),
        parsed: { ...parsed, events, unparsed: parsed.unparsed.slice(0, 500) },
        unparsedCount: parsed.unparsed.length,
      }
      const summary: UploadedLogSummary = {
        id, charId, charName, side, events: events.length, uploadedAt: log.uploadedAt,
      }
      const packed = await packJson(log.parsed)
      await this.scheduleAnalysis()
      this.store.saveLog(log, packed, resolution)
      this.broadcast({ type: 'log_added', log: summary, names: resolution.names })
      return Response.json(summary)
    } finally {
      clearTimeout(timeout)
    }
  }

  private async lookupListener(name: string, signal: AbortSignal): Promise<Record<string, number | null>> {
    try {
      return await abortable(signal, () => this.services.namesToCharacters([name], signal))
    } catch {
      throw new ApiFailure('br_unavailable', 'Character name lookup is unavailable')
    }
  }

  private async listenerSide(charId: number, { meta, sides }: Battle, signal: AbortSignal): Promise<number> {
    const historical = sides.get(charId)
    if (historical !== undefined) return historical
    try {
      const entries = await abortable(signal, () => this.services.affiliations([charId], signal))
      const entry = entries.find((p) => p.charId === charId)
      return entry ? sideOf(entry, meta.teams) : -1
    } catch {
      throw new ApiFailure('br_unavailable', 'Character affiliation lookup is unavailable')
    }
  }

  private addNames(events: LogEvent[], from: number, names: Set<string>, checked: Set<string>): number | null {
    for (let i = from; i < events.length; i++) {
      if (names.size >= NAME_LIMIT) return i
      const { other } = events[i]!
      const name = other.name || other.raw
      if (!name || name.length > 37 || /[\[\]()<>*]/.test(name) || checked.has(name)) continue
      checked.add(name)
      if (!this.store.hasName(name)) names.add(name)
    }
    return null
  }

  private async resolveNames(events: LogEvent[], battle: Battle, signal: AbortSignal): Promise<{
    names: NameIndex
    currentOffset: number | null
    pending?: { id: string; offset: number | null }
  }> {
    if (signal.aborted) return { names: {}, currentOffset: 0 }
    const prior = await this.store.pendingLog()
    const names = new Set<string>()
    const checked = new Set<string>()
    const pending = prior && { id: prior.id, offset: this.addNames(prior.events, prior.nameOffset, names, checked) }
    const currentOffset = this.addNames(events, 0, names, checked)
    if (!names.size) return { names: {}, currentOffset, pending }
    const candidates = [...names]
    const resolved: NameIndex = Object.create(null)
    for (let i = 0; i < candidates.length; i += ESI_NAME_BATCH) {
      const batch = candidates.slice(i, i + ESI_NAME_BATCH)
      try {
        Object.assign(resolved, await abortable(signal, () => this.lookupNames(batch, battle, signal)))
      } catch {
        // Keep completed batches. The next upload can skip their names and retry from the cursors.
        return { names: resolved, currentOffset: 0 }
      }
    }
    return { names: resolved, currentOffset, pending }
  }

  private async lookupNames(names: string[], { meta, sides }: Battle, signal: AbortSignal): Promise<NameIndex> {
    const ids = await this.services.namesToCharacters(names, signal)
    signal.throwIfAborted()
    const charIds = [...new Set(names.map((name) => characterId(ids, name)))]
      .filter((id) => id !== null)
      .filter((id) => !sides.has(id))
    const affiliations = charIds.length ? await this.services.affiliations(charIds, signal) : []
    const currentSides = new Map(affiliations.map((entry) => [entry.charId, sideOf(entry, meta.teams)]))
    return Object.fromEntries(names.map((name) => {
      const charId = characterId(ids, name)
      return [name, charId === null ? null : { charId, side: sides.get(charId) ?? currentSides.get(charId) ?? -1 }]
    }))
  }

  private async setFit(charId: number, eft: string): Promise<Response> {
    const header = eft.split(/\r\n|\n|\r/, 1)[0]?.trim() ?? ''
    const fields = /^\[([^,\[\]]+),(.+)\]$/.exec(header)
    if (!fields?.[1]?.trim() || !fields[2]?.trim()) {
      throw new ApiFailure('bad_eft', 'The first line of an EFT fit must be [Ship, Name]')
    }
    await this.store.migrateIfNeeded((await this.battle()).meta)
    const fit: FitEntry = { charId, eft, setAt: this.services.now() }
    await this.scheduleAnalysis()
    this.store.setFit(fit)
    this.broadcast({ type: 'fit_set', fit })
    return Response.json(fit)
  }

  private openWebSocket(meta: BattleMeta): Response {
    const snapshot: ServerMessage = { type: 'snapshot', state: this.store.summary(meta) }
    const text = JSON.stringify(snapshot)
    if (encoder.encode(text).byteLength >= SOCKET_LIMIT) {
      throw new ApiFailure('too_large', 'Battle snapshot is too large for WebSocket. Fetch the battle over HTTP.')
    }
    const { 0: client, 1: server } = new WebSocketPair()
    this.ctx.acceptWebSocket(server)
    server.send(text)
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
    const fits = encoder.encode(text).byteLength < SOCKET_LIMIT
    for (const socket of sockets) {
      try {
        if (fits) socket.send(text)
        else socket.close(1009, 'Update too large. Fetch the battle over HTTP.')
      } catch {
        // A disconnected viewer does not prevent other viewers from receiving the update.
      }
    }
  }
}
