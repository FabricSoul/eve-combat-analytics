import type { BattleMeta } from '../contract'
import { ApiFailure, EsiError, USER_AGENT, type EsiDeps } from '../esi/client'
import { idsToNames } from '../esi/names'
import { normalizeBrComposition } from './normalize'

export interface FetchBattleDeps extends EsiDeps {
  /** Epoch ms; becomes BattleMeta.fetchedAt. */
  now: () => number
}

const BR_COMPOSITION = 'https://br.evetools.org/newapi/br/composition'
const POLL_MS = 2000
const POLL_BUDGET_MS = 30_000
const MAX_ATTEMPTS = 3
const BACKOFF_MS = 500

type Body = { kind: 'ok'; body: unknown } | { kind: 'processing' }

/** Elapsed ms since `start` on the injected clock, or the time we slept ourselves if that is larger. */
interface Clock {
  elapsed(): number
  sleep(ms: number): Promise<void>
}

function makeClock(deps: FetchBattleDeps): Clock {
  const start = deps.now()
  let slept = 0
  return {
    elapsed: () => Math.max(deps.now() - start, slept),
    async sleep(ms) {
      slept += ms
      await deps.sleep(ms)
    },
  }
}

const overBudget = (brId: string) =>
  new ApiFailure('br_unavailable', `battle report ${brId} was not ready within ${POLL_BUDGET_MS / 1000} s`)

/** One GET with retries on 5xx / network errors, all inside the shared deadline. Throws ApiFailure. */
async function getComposition(brId: string, deps: FetchBattleDeps, clock: Clock): Promise<Body> {
  for (let attempt = 1; ; attempt++) {
    const remaining = POLL_BUDGET_MS - clock.elapsed()
    if (remaining <= 0) throw overBudget(brId)
    let res: Response | null = null
    let body: unknown
    let bodyError = false
    try {
      res = await deps.fetch(`${BR_COMPOSITION}/${brId}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
        signal: AbortSignal.timeout(remaining),
      })
      if (res.status !== 404 && res.status < 500) {
        try {
          body = await res.json()
        } catch (e) {
          // an abort while reading the body is a timeout, not a bad document
          if (e instanceof DOMException && (e.name === 'TimeoutError' || e.name === 'AbortError')) throw e
          bodyError = true
        }
      }
    } catch {
      res = null // network error or timeout: treated like a 5xx below
    }
    if (clock.elapsed() > POLL_BUDGET_MS) throw overBudget(brId)
    if (res && res.status === 404) throw new ApiFailure('br_not_found', `battle report ${brId} not found`)
    if (res && res.status < 500) {
      if (bodyError) throw new ApiFailure('br_not_found', `battle report ${brId} returned an invalid body`)
      if (!res.ok) throw new ApiFailure('br_not_found', `battle report ${brId}: HTTP ${res.status}`)
      if (body && typeof body === 'object' && (body as { status?: unknown }).status === 'processing') {
        return { kind: 'processing' }
      }
      return { kind: 'ok', body }
    }
    if (attempt >= MAX_ATTEMPTS) {
      throw new ApiFailure('br_unavailable', `br.evetools.org unavailable (${res ? `HTTP ${res.status}` : 'network error'})`)
    }
    const wait = Math.min(BACKOFF_MS * 2 ** (attempt - 1), POLL_BUDGET_MS - clock.elapsed())
    if (wait <= 0) throw overBudget(brId)
    await clock.sleep(wait)
  }
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const optNum = (v: unknown) => v === undefined || isNum(v)

function validParticipant(p: unknown): boolean {
  return isRecord(p) && (['ally', 'corp', 'char', 'ship', 'weap', 'dmg'] as const).every((k) => optNum(p[k]))
}

function validTeamMember(m: unknown): boolean {
  return isNum(m) || (typeof m === 'string' && /^(corp:)?\d+$/.test(m))
}

function validKillmail(k: unknown): boolean {
  return (
    isRecord(k) &&
    isNum(k.id) &&
    typeof k.hash === 'string' &&
    isNum(k.system) &&
    isNum(k.time) &&
    isNum(k.totalValue) &&
    validParticipant(k.victim) &&
    (k.attackers === undefined || (Array.isArray(k.attackers) && k.attackers.every(validParticipant)))
  )
}

function validRelated(r: unknown): boolean {
  if (!isRecord(r) || !isNum(r.start) || !isNum(r.end) || r.start > r.end || !isNum(r.systemID)) return false
  const sys = r.system
  if (!isRecord(sys) || typeof sys.name !== 'string' || typeof sys.region !== 'string') return false
  if (!(isNum(sys.ss) || (typeof sys.ss === 'string' && sys.ss.trim() !== '' && Number.isFinite(Number(sys.ss))))) {
    return false
  }
  return r.kms === undefined || (Array.isArray(r.kms) && r.kms.every(validKillmail))
}

/** Shape check of the raw composition, before any ESI call. Throws br_not_found. */
function validateComposition(raw: unknown, brId: string): void {
  const bad = (why: string) => new ApiFailure('br_not_found', `battle report ${brId}: ${why}`)
  if (!isRecord(raw) || typeof raw.id !== 'string' || !Array.isArray(raw.teams) || !Array.isArray(raw.relateds)) {
    throw bad('no composition')
  }
  if (raw.id.toLowerCase() !== brId) throw bad(`composition is for another battle (${raw.id})`)
  if (!raw.teams.every((t) => Array.isArray(t) && t.every(validTeamMember))) throw bad('malformed teams')
  if (!raw.relateds.every(validRelated)) throw bad('malformed related systems or killmails')
}

function collectIds(raw: unknown): number[] {
  const c = raw as {
    teams: (string | number)[][]
    relateds: { kms?: { victim: Record<string, number>; attackers?: Record<string, number>[] }[] }[]
  }
  const ids = new Set<number>()
  const add = (v: unknown) => {
    if (typeof v === 'number' && v > 0) ids.add(v)
  }
  for (const team of c.teams) {
    for (const m of team) add(Number(String(m).replace(/^(ally|corp):/, '')))
  }
  for (const r of c.relateds) {
    for (const k of r.kms ?? []) {
      for (const p of [k.victim, ...(k.attackers ?? [])]) {
        add(p.char)
        add(p.corp)
        add(p.ally)
        add(p.ship)
        add(p.weap)
      }
    }
  }
  return [...ids]
}

export async function fetchBattleMeta(brId: string, deps: FetchBattleDeps): Promise<BattleMeta> {
  const clock = makeClock(deps)
  let raw: unknown
  for (;;) {
    const r = await getComposition(brId, deps, clock)
    if (r.kind === 'ok') {
      raw = r.body
      break
    }
    const wait = Math.min(POLL_MS, POLL_BUDGET_MS - clock.elapsed())
    if (wait <= 0) throw overBudget(brId)
    await clock.sleep(wait)
  }

  validateComposition(raw, brId)

  let names: BattleMeta['names']
  try {
    names = await idsToNames(collectIds(raw), deps)
  } catch (e) {
    if (e instanceof EsiError) throw new ApiFailure('br_unavailable', `ESI name lookup failed: ${e.message}`)
    throw e
  }
  try {
    // the canonical key is the requested id, never a differently-cased echo
    return normalizeBrComposition({ ...(raw as object), id: brId }, names, deps.now())
  } catch {
    throw new ApiFailure('br_not_found', `battle report ${brId} is not a valid composition`)
  }
}
