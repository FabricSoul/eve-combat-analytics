import { DurableObject } from 'cloudflare:workers'
import { analyze } from '../core/analysis/analyze'
import { EQUIPMENT_BUCKET_KEY } from '../core/analysis/identities'
import { MAX_BATTLE_SIDES } from '../core/analysis/sides'
import { sideOf } from '../core/br/normalize'
import { isKnownNonPilotName } from '../core/log/counterparty'
import { GamelogFormatError } from '../core/contract'
import type {
  ApiError, BattleMeta, BattleState, EntityKey, FitEntry, IdentityMerge, KillmailParticipant, LogEvent, NameIndex, ServerMessage,
  SideBatchEdit, SideBatchResult, SideOverride, SideSubject, UploadResult,
} from '../core/contract'
import { analysisJson } from './analysis-json'
import { battleAffiliations } from './affiliation-history'
import { ApiFailure, battlePath, errorResponse, readText, upstreamFailure } from './http'
import type { Env } from './index'
import { fetchKillmailFit } from './killmail-fit'
import { abortable, createServices, withDeadline } from './services'
import type { Services } from './services'
import { affiliationNameIds, BattleStorage, needsAnalysis, packJson, packStream } from './storage'
import type { AffiliationRefresh, MetaNameResolution, SideAssignment, StoredAffiliation, StoredLog } from './storage'

const NAME_LIMIT = 2000
const ESI_NAME_BATCH = 500
const SOCKET_LIMIT = 1024 * 1024
const FIT_EFT_LIMIT = 64 * 1024
const FIT_JSON_LIMIT = 7 * FIT_EFT_LIMIT + 64 // EFT with JSON escaping, plus 64 KiB for metadata.
const FIT_RECOVERY_TIMEOUT_MS = 3_000
const FIT_RECOVERY_CONCURRENCY = 3
const fitLimitMessage = 'EFT fits must be at most 64 KiB'
const SIDE_BATCH_LIMIT = 1024 * 1024
const BATTLE_TIME_AFFILIATION_VERSION = 2
const encoder = new TextEncoder()
const undoHeader = 'X-EVE-Undo'

function characterId(ids: Record<string, number | null>, name: string): number | null {
  return Object.hasOwn(ids, name) ? ids[name] ?? null : null
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}

async function sha256(text: string): Promise<string> {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(text))))
}

type AffiliationIds = Pick<KillmailParticipant, 'corpId' | 'allyId'>

function assignSide(affiliation: AffiliationIds | null | undefined, teams: BattleMeta['teams']): SideAssignment {
  if (!affiliation) return { side: -1, corpId: undefined, allyId: undefined }
  return {
    side: sideOf(affiliation, teams),
    corpId: affiliation.corpId ?? undefined,
    allyId: affiliation.allyId,
  }
}

function historicalSides(meta: BattleMeta): Map<number, SideAssignment> {
  const sides = new Map<number, SideAssignment>()
  for (const { victim, attackers } of meta.killmails) {
    for (const p of [victim, ...attackers]) {
      if (p.charId !== null && (sides.get(p.charId)?.side ?? -1) < 0) {
        sides.set(p.charId, assignSide(p, meta.teams))
      }
    }
  }
  return sides
}

function isSideSubject(subject: unknown): subject is SideSubject {
  if (typeof subject !== 'string') return false
  const match = /^(?:ally|corp|char):([1-9]\d{0,15})$/.exec(subject)
  return match?.[0] === subject && Number.isSafeInteger(Number(match[1]))
}

async function readFit(request: Request): Promise<Pick<FitEntry, 'eft' | 'mutated'>> {
  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0]?.trim().toLowerCase()
  if (mediaType !== 'application/json') return { eft: await readText(request, FIT_EFT_LIMIT, fitLimitMessage) }

  const text = await readText(request, FIT_JSON_LIMIT, 'JSON fit is too large')
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch {
    throw new ApiFailure('bad_request', 'Expected a JSON fit')
  }
  if (!data || typeof data !== 'object' || !('eft' in data) || typeof data.eft !== 'string') {
    throw new ApiFailure('bad_request', 'Expected EFT text in the JSON fit')
  }
  if (encoder.encode(data.eft).byteLength > FIT_EFT_LIMIT) throw new ApiFailure('too_large', fitLimitMessage)
  if (!('mutated' in data)) return { eft: data.eft }
  const { mutated } = data
  if (!Array.isArray(mutated) || mutated.some((name) => typeof name !== 'string' || !name.trim() || /[\r\n]/.test(name))
    || encoder.encode(JSON.stringify(mutated)).byteLength > FIT_EFT_LIMIT) {
    throw new ApiFailure('bad_request', 'Expected a list of substituted module names')
  }
  return { eft: data.eft, ...(mutated.length ? { mutated: [...new Set<string>(mutated)] } : {}) }
}

function normalizeLegacyEft(eft: string): string {
  return eft.split(/\r\n|\r|\n/).map((line) => line.trimEnd()).join('\n').replace(/^\n+|\n+$/g, '')
}

async function readEdit(request: Request, kind: 'side' | 'identity' | 'side batch'): Promise<unknown> {
  const limit = kind === 'side batch' ? SIDE_BATCH_LIMIT : 1024
  try {
    return JSON.parse(await readText(request, limit, 'Battle edit is too large'))
  } catch {
    throw new ApiFailure('bad_request', `Expected a JSON ${kind} edit`)
  }
}

function isMergeSource(from: unknown): from is EntityKey {
  return typeof from === 'string' && from !== EQUIPMENT_BUCKET_KEY && (/^ship:[1-9]\d*:-?\d+$/.test(from) || (from.startsWith('name:') && !!from.slice(5).trim()))
}

function isMergeTarget(to: unknown): to is IdentityMerge['to'] {
  return isSideSubject(to) && to.startsWith('char:')
}

type Battle = { meta: BattleMeta; sides: Map<number, SideAssignment> }

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
  private legacyFitRecovery?: Promise<void>
  private tail: Promise<void> = Promise.resolve()
  private readonly analyzingRevisions = new Set<number>()

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
        await this.ensureAnalysisScheduled()
        const battle = await this.battle()
        const response = Response.json(this.store.summary(battle.meta))
        this.startLegacyFitRecovery(battle.meta)
        return response
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
      if ((request.method === 'PUT' || request.method === 'DELETE') && route.startsWith('fits/')) {
        const charIdText = route.slice('fits/'.length)
        const charId = Number(charIdText)
        if (!/^\d+$/.test(charIdText) || !Number.isSafeInteger(charId) || charId <= 0) {
          throw new ApiFailure('bad_request', 'Invalid character ID')
        }
        const ifMatch = request.headers.get('If-Match')
        const fit = request.method === 'PUT' ? await readFit(request) : undefined
        return await this.inOrder(() => {
          if (ifMatch !== null) this.requireFitMatch(charId, ifMatch)
          return fit ? this.setFit(charId, fit, request.headers.has(undoHeader)) : this.deleteFit(charId)
        })
      }
      if (request.method === 'PUT' && route === 'sides') {
        const data = await readEdit(request, 'side')
        return await this.inOrder(() => this.setSide(data, request.headers))
      }
      if (request.method === 'PUT' && route === 'sides/batch') {
        const data = await readEdit(request, 'side batch')
        return await this.inOrder(() => this.setSideBatch(data, request.headers))
      }
      if (request.method === 'PUT' && route === 'identities') {
        const data = await readEdit(request, 'identity')
        return await this.inOrder(() => this.setIdentity(data, request.headers))
      }
      if (request.method === 'GET' && route === 'ws') {
        if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
          throw new ApiFailure('bad_request', 'WebSocket upgrade required', 426)
        }
        const battle = await this.battle()
        const response = await this.inOrder(async () => {
          await this.scheduleMissingAnalysis()
          return this.openWebSocket(battle.meta)
        })
        this.startLegacyFitRecovery(battle.meta)
        return response
      }
      throw new ApiFailure('br_not_found', 'Battle API route not found')
    } catch (error) {
      return errorResponse(error)
    }
  }

  private scheduleAnalysis(): Promise<void> {
    return this.ctx.storage.setAlarm(Date.now() + this.analysisDelayMs)
  }

  private analysisNeedsAlarm(): boolean {
    const status = this.store.analysisStatus()
    return needsAnalysis(status) && !this.analyzingRevisions.has(status.revision)
  }

  private async scheduleMissingAnalysis(): Promise<void> {
    if (this.analysisNeedsAlarm() && await this.ctx.storage.getAlarm() === null && this.analysisNeedsAlarm()) {
      await this.scheduleAnalysis()
    }
  }

  private async ensureAnalysisScheduled(): Promise<void> {
    if (this.analysisNeedsAlarm()) await this.inOrder(() => this.scheduleMissingAnalysis())
  }

  override async alarm(): Promise<void> {
    if (!this.store.exists()) return
    const status = this.store.analysisStatus()
    const { revision } = status
    if (!needsAnalysis(status) || this.analyzingRevisions.has(revision)) return

    this.analyzingRevisions.add(revision)
    try {
      const battle = await this.battle()
      const state = await this.store.state(battle.meta)
      const refresh = (status.analyzerVersion ?? 0) < BATTLE_TIME_AFFILIATION_VERSION
        ? await withDeadline(35_000, (signal) => this.refreshAffiliations(state, battle, signal)) : undefined
      // An upload can commit while logs are read or affiliations are fetched.
      if (this.store.analysisStatus().revision !== revision) return
      const analysis = analyze(state)
      const uploaderSides: Record<number, number> = {}
      for (const log of state.logs) {
        const entity = analysis.entities[`char:${log.charId}`]
        if (entity && entity.sideSource !== 'manual' && entity.side !== log.side) uploaderSides[log.charId] = entity.side
      }
      const chunks = await packStream(analysisJson(analysis))
      const published = this.store.publishAnalysis(revision, chunks, JSON.stringify(uploaderSides), refresh)
      if (published) {
        if (refresh) battle.meta = state.meta
        if (refresh || published.uploaderSidesChanged) {
          this.broadcast({ type: 'snapshot', state: this.store.summary(battle.meta) })
        }
        this.broadcast({ type: 'analysis_ready', version: published.version })
      }
    } finally {
      this.analyzingRevisions.delete(revision)
    }
  }

  private async refreshAffiliations(state: BattleState, battle: Battle, signal: AbortSignal): Promise<AffiliationRefresh | undefined> {
    const entries = [...state.logs, ...Object.values(state.names)].filter((entry) => entry !== null)
      .filter(({ charId }) => !battle.sides.has(charId))
    const ids = [...new Set(entries.map(({ charId }) => charId))]
    if (!ids.length) return undefined
    const start = Math.min(...state.meta.windows.map((window) => window.start))
    const resolved = await battleAffiliations(ids, start, this.store, this.services, signal, {
      historyTimeout: 25_000, allowPartial: true,
    })
    const assignments = new Map<number, SideAssignment>()
    for (const entry of entries) {
      const affiliation = resolved.get(entry.charId)
      if (affiliation === undefined) continue
      const next = assignSide(affiliation, state.meta.teams)
      if (entry.side === next.side && entry.corpId === next.corpId && entry.allyId === next.allyId) continue
      Object.assign(entry, next)
      assignments.set(entry.charId, next)
    }
    if (!assignments.size) return undefined
    const idsToName = [...assignments].flatMap(([charId, entry]) => affiliationNameIds({ charId, ...entry }))
    const metaNames = await this.lookupMetaNames(state.meta, idsToName, signal)
    state.meta = { ...state.meta, names: { ...state.meta.names, ...metaNames.names } }
    return { assignments, metaNames }
  }

  // RPC keeps the stored bytes compressed across the DO-to-Worker hop.
  async readAnalysis(ifNoneMatch: string | null): Promise<AnalysisRead> {
    if (!this.store.exists()) return { status: 404 }
    await this.ensureAnalysisScheduled()
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
    // Uploads run in order (inOrder), so a teammate's simultaneous copy of the same file lands here as a duplicate.
    if (existing) return Response.json({ ...existing, duplicate: true } satisfies UploadResult)

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
      const assignment = await this.listenerSide(charId, battle, signal)
      const resolution = await this.resolveNames(events, battle, signal)
      const metaNames = await this.resolveMetaNames(battle.meta, { charId, ...assignment }, resolution.names, signal)
      // No more ESI calls are needed after this point.
      clearTimeout(timeout)

      const log: StoredLog = {
        id, charId, charName, ...assignment, uploadedAt: this.services.now(),
        parsed: { ...parsed, events, unparsed: parsed.unparsed.slice(0, 500) },
        unparsedCount: parsed.unparsed.length,
      }
      const packed = await packJson(log.parsed)
      await this.scheduleAnalysis()
      const summary = this.store.saveLog(log, packed, resolution, metaNames)
      const delta = Object.keys(metaNames.names).length ? metaNames.names : undefined
      if (delta) battle.meta = { ...battle.meta, names: { ...battle.meta.names, ...delta } }
      this.broadcast({ type: 'log_added', log: summary, names: resolution.names, metaNames: delta })
      return Response.json(summary)
    } finally {
      clearTimeout(timeout)
    }
  }

  private async resolveMetaNames(
    meta: BattleMeta, listener: { charId: number } & StoredAffiliation, names: NameIndex, signal: AbortSignal,
  ): Promise<MetaNameResolution> {
    const ids = [listener, ...Object.values(names)].flatMap((entry) => entry ? affiliationNameIds(entry) : [])
    return this.lookupMetaNames(meta, ids, signal)
  }

  private async lookupMetaNames(meta: BattleMeta, idsToName: number[], signal: AbortSignal): Promise<MetaNameResolution> {
    const ids = new Set([...this.store.pendingMetaNameIds(), ...idsToName])
    const missing = [...ids].filter((id) => !Object.hasOwn(meta.names, id))
    if (!missing.length) return { names: {}, pendingIds: [] }
    try {
      const names = await abortable(signal, () => this.services.idsToNames(missing, signal))
      return { names, pendingIds: [] }
    } catch {
      // Metadata lookup is best-effort. Save the upload and retry on a later one.
      return { names: {}, pendingIds: missing }
    }
  }

  private async lookupListener(name: string, signal: AbortSignal): Promise<Record<string, number | null>> {
    try {
      return await abortable(signal, () => this.services.namesToCharacters([name], signal))
    } catch {
      throw new ApiFailure('br_unavailable', 'Character name lookup is unavailable')
    }
  }

  private async listenerSide(charId: number, { meta, sides }: Battle, signal: AbortSignal): Promise<SideAssignment> {
    const historical = sides.get(charId)
    if (historical !== undefined) return historical
    try {
      const start = Math.min(...meta.windows.map((window) => window.start))
      const entries = await battleAffiliations([charId], start, this.store, this.services, signal)
      return assignSide(entries.get(charId), meta.teams)
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
      if (!isKnownNonPilotName(name) && !this.store.hasName(name)) names.add(name)
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
    const start = Math.min(...meta.windows.map((window) => window.start))
    const affiliations = await battleAffiliations(charIds, start, this.store, this.services, signal)
    return Object.fromEntries(names.map((name) => {
      const charId = characterId(ids, name)
      if (charId === null) return [name, null]
      const assignment = sides.get(charId) ?? assignSide(affiliations.get(charId), meta.teams)
      return [name, { charId, ...assignment }]
    }))
  }

  private startLegacyFitRecovery(meta: BattleMeta): void {
    if (this.legacyFitRecovery) return
    this.legacyFitRecovery = this.recoverLegacyFits(meta)
      .catch((error: unknown) => console.error('Legacy fit recovery failed', error))
      .finally(() => { this.legacyFitRecovery = undefined })
  }

  private async recoverLegacyFits(meta: BattleMeta): Promise<void> {
    const candidates = this.store.legacyFits().flatMap((fit) => {
      const eft = normalizeLegacyEft(fit.eft)
      // The canonical header identifies the one loss to check, even for pilots with several losses.
      const id = Number(/^\[[^\n]+, Killmail ([1-9]\d{0,14})\](?=\n|$)/.exec(eft)?.[1])
      const loss = meta.killmails.find((kill) => kill.id === id && kill.victim.charId === fit.charId)
      return loss && /^[a-f0-9]{40}$/i.test(loss.hash) ? [{ fit, eft, loss }] : []
    })
    const queue = candidates.values()
    const workers = Array.from({ length: Math.min(candidates.length, FIT_RECOVERY_CONCURRENCY) }, async () => {
      for (const { fit, eft, loss } of queue) {
        const canonical = await withDeadline(FIT_RECOVERY_TIMEOUT_MS, (signal) =>
          fetchKillmailFit(loss.id, loss.hash.toLowerCase(), (input, init) => fetch(input, { ...init, signal })),
        ).catch(() => undefined)
        if (!canonical || canonical.charId !== fit.charId) continue
        const mutated = normalizeLegacyEft(canonical.eft) === eft ? canonical.mutated ?? [] : []
        if (this.store.recoverFitMutations(fit, mutated) && mutated.length) {
          this.broadcast({ type: 'fit_set', fit: { ...fit, mutated } })
        }
      }
    })
    for (const result of await Promise.allSettled(workers)) {
      if (result.status === 'rejected') console.error('Legacy fit recovery failed', result.reason)
    }
  }

  private requireFitMatch(charId: number, ifMatch: string): void {
    const currentTag = this.store.fitEtag(charId)
    const matches = ifMatch.trim() === '*'
      ? currentTag !== undefined
      : typeof currentTag === 'string' && ifMatch.split(',').some((tag) => tag.trim() === currentTag)
    if (!matches) throw new ApiFailure('bad_request', 'The fit has changed', 412)
  }

  private async setFit(charId: number, text: Pick<FitEntry, 'eft' | 'mutated'>, undoReceipt: boolean): Promise<Response> {
    const header = text.eft.split(/\r\n|\n|\r/, 1)[0]?.trim() ?? ''
    const fields = /^\[([^,\[\]]+),(.+)\]$/.exec(header)
    if (!fields?.[1]?.trim() || !fields[2]?.trim()) {
      throw new ApiFailure('bad_eft', 'The first line of an EFT fit must be [Ship, Name]')
    }
    await this.store.migrateIfNeeded((await this.battle()).meta)
    const fit: FitEntry = { charId, ...text, setAt: this.services.now() }
    const etag = `"${crypto.randomUUID()}"`
    await this.scheduleAnalysis()
    const previous = undoReceipt ? this.store.fit(charId) ?? null : undefined
    this.store.setFit(fit, etag)
    const versionedFit = { ...fit, etag }
    this.broadcast({ type: 'fit_set', fit: versionedFit })
    return Response.json(undoReceipt ? { ...fit, previous } : fit, { headers: { ETag: etag } })
  }

  private async deleteFit(charId: number): Promise<Response> {
    await this.store.migrateIfNeeded((await this.battle()).meta)
    if (this.store.deleteFit(charId)) {
      await this.scheduleAnalysis()
      this.broadcast({ type: 'fit_removed', charId })
    }
    return Response.json({ removed: charId })
  }

  private async setSide(data: unknown, headers: Headers): Promise<Response> {
    const { meta } = await this.battle()
    const current = this.store.sideOverrides()
    const nextSide = current.reduce((next, { side }) => Math.max(next, side + 1), meta.teams.length)
    if (!data || typeof data !== 'object' || !('subject' in data) || !isSideSubject(data.subject)
      || !('side' in data) || (data.side !== 'new' && (typeof data.side !== 'number' || !Number.isInteger(data.side)))) {
      throw new ApiFailure('bad_request', 'Expected an alliance, corporation or character subject and a valid side index')
    }
    // setSide runs in the same serialized queue as every other side edit.
    const ifMatch = headers.get('If-Match')
    const { subject } = data
    const side = data.side === 'new' ? nextSide : data.side
    if (side < -1 || (ifMatch === null && side > nextSide) || side >= Math.max(MAX_BATTLE_SIDES, meta.teams.length)) {
      throw new ApiFailure('bad_request', 'Expected an alliance, corporation or character subject and a valid side index')
    }
    const tags = await this.requireSideMatch([subject], ifMatch)
    const previous = [{ subject, side: current.find((override) => override.subject === subject)?.side ?? -1 }]
    const undoReceipt = headers.has(undoHeader)
    const metadata = undoReceipt ? { previous, previousTags: Object.fromEntries(tags) } : undefined
    if (undoReceipt && ifMatch === null && previous[0]!.side === side) {
      return Response.json({ subject, side, source: 'manual', setAt: this.services.now(), ...metadata })
    }
    const { applied: [override], etag } = await this.applySideEdits([{ subject, side }], undoReceipt ? meta : undefined)
    return Response.json({ ...override, ...metadata }, { headers: { ETag: etag } })
  }

  private async setSideBatch(data: unknown, headers: Headers): Promise<Response> {
    if (data && typeof data === 'object' && 'restore' in data) {
      return this.restoreSideBatch(data.restore, headers.get('If-Match'))
    }
    const { meta } = await this.battle()
    const limit = Math.max(MAX_BATTLE_SIDES, meta.teams.length)
    if (!data || typeof data !== 'object' || !('edits' in data) || !Array.isArray(data.edits) || !data.edits.length) {
      throw new ApiFailure('bad_request', 'Expected a nonempty list of side edits')
    }
    const requested = new Map<SideSubject, number>()
    for (const edit of data.edits as unknown[]) {
      if (!edit || typeof edit !== 'object' || !('subject' in edit) || !isSideSubject(edit.subject)
        || !('side' in edit) || typeof edit.side !== 'number' || !Number.isInteger(edit.side)
        || edit.side < -1 || edit.side >= limit || requested.has(edit.subject)) {
        throw new ApiFailure('bad_request', 'Expected distinct subjects and valid numeric side indices')
      }
      requested.set(edit.subject, edit.side)
    }

    const tags = await this.requireSideMatch([...requested.keys()], headers.get('If-Match'))
    const current = this.store.sideOverrides().sort((a, b) => a.setAt - b.setAt)
    const assigned = new Map(current.map(({ subject, side }) => [subject, side]))
    const edits = [...requested].flatMap(([subject, side]) => side === (assigned.get(subject) ?? -1) ? [] : [{ subject, side }])
    const changed = new Set(edits.map(({ subject }) => subject))
    const previous = current.filter(({ subject }) => changed.has(subject)).map(({ subject, side }) => ({ subject, side }))
    for (const { subject } of edits) if (!assigned.has(subject)) previous.push({ subject, side: -1 })

    const undoReceipt = headers.has(undoHeader)
    const { applied, etag } = edits.length ? await this.applySideEdits(edits, undoReceipt ? meta : undefined) : { applied: [] }
    const result = { applied, previous } satisfies SideBatchResult
    const previousTags = undoReceipt ? { previousTags: Object.fromEntries(tags) } : undefined
    return Response.json({ ...result, ...previousTags }, { headers: etag ? { ETag: etag } : undefined })
  }

  private async restoreSideBatch(restore: unknown, ifMatch: string | null): Promise<Response> {
    if (!Array.isArray(restore) || !restore.length) {
      throw new ApiFailure('bad_request', 'Expected a nonempty list of side restores')
    }
    const requested = new Map<SideSubject, string>()
    for (const item of restore as unknown[]) {
      if (!item || typeof item !== 'object' || !('subject' in item) || !isSideSubject(item.subject)
        || !('through' in item) || typeof item.through !== 'string' || !/^"[\da-f-]{36}"$/.test(item.through)
        || requested.has(item.subject)) {
        throw new ApiFailure('bad_request', 'Expected distinct subjects and side edit revisions')
      }
      requested.set(item.subject, item.through)
    }
    if (!ifMatch) throw new ApiFailure('bad_request', 'A side restore requires an edit revision', 412)
    await this.requireSideMatch([...requested.keys()], ifMatch)
    const etag = `"${crypto.randomUUID()}"`
    await this.scheduleAnalysis()
    const result = this.store.restoreSides(requested, etag, this.services.now())
    if (!result) throw new ApiFailure('bad_request', 'Side assignments have changed', 412)
    this.broadcast({ type: 'sides_set', overrides: result.overrides })
    return Response.json({ applied: result.applied }, { headers: { ETag: etag } })
  }

  private async requireSideMatch(subjects: readonly SideSubject[], ifMatch: string | null) {
    const sorted = [...subjects].sort()
    const tags = this.store.sideTags(sorted)
    const entries = sorted.map((subject, index) => [subject, tags[index]!] as const)
    if (ifMatch !== null) {
      const sameTag = tags[0] && tags.every((tag) => tag === tags[0]) ? tags[0] : null
      const validator = sameTag ?? `"${await sha256(JSON.stringify(entries))}"`
      if (!ifMatch.split(',').some((tag) => tag.trim() === validator)) {
        throw new ApiFailure('bad_request', 'Side assignments have changed', 412)
      }
    }
    return entries
  }

  private async applySideEdits(edits: SideBatchEdit['edits'], captureFor?: BattleMeta) {
    const setAt = this.services.now()
    if (!this.store.canEditSide(setAt)) {
      throw new ApiFailure('bad_request', 'A battle can accept at most 30 side edits per minute', 429)
    }
    const applied = edits.map((edit): SideOverride => ({ ...edit, source: 'manual', setAt }))
    const etag = `"${crypto.randomUUID()}"`
    await this.scheduleAnalysis()
    const overrides = this.store.setSides(applied, setAt, etag, captureFor)
    this.broadcast({ type: 'sides_set', overrides })
    return { applied, etag }
  }

  private async setIdentity(data: unknown, headers: Headers): Promise<Response> {
    if (!data || typeof data !== 'object' || !('from' in data) || !isMergeSource(data.from)
      || !('to' in data) || (data.to !== null && !isMergeTarget(data.to))) {
      throw new ApiFailure('bad_request', 'Expected an unresolved source and a character target or null')
    }
    const { from, to } = data
    const ifMatch = headers.get('If-Match')
    const previousTag = this.store.identityTag(from)
    if (ifMatch !== null && (previousTag === null || !ifMatch.split(',').some((tag) => tag.trim() === previousTag))) {
      throw new ApiFailure('bad_request', 'Identity merges have changed', 412)
    }
    const current = this.store.identityMerges()
    const previous = current?.find((merge) => merge.from === from) ?? null
    const undoReceipt = headers.has(undoHeader)
    if ((to !== null && (to !== previous?.to || !undoReceipt)) || (ifMatch === null && !previous)) {
      const { meta } = await this.battle()
      const state = await this.store.state(meta)
      // Check the original source even when it has already disappeared into a merge.
      const { entities } = analyze({ ...state, identityMerges: current?.filter((merge) => merge.from !== from) })
      if (!Object.hasOwn(entities, from) || (to !== null && !Object.hasOwn(entities, to))) {
        throw new ApiFailure('bad_request', 'The source and target must be entities in this battle')
      }
    }

    if (ifMatch === null && (previous?.to ?? null) === to && (undoReceipt || to === null)) {
      return Response.json(previous ?? { removed: from })
    }
    const setAt = this.services.now()
    const etag = `"${crypto.randomUUID()}"`
    await this.scheduleAnalysis()
    const merges = this.store.setIdentity(from, to, setAt, etag)
    this.broadcast({ type: 'identities_set', merges })
    const result = to === null ? { removed: from } : { from, to, setAt } satisfies IdentityMerge
    return Response.json(undoReceipt ? { ...result, previous, previousTag } : result, { headers: { ETag: etag } })
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
