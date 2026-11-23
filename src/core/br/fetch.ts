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

/** One GET with retries on 5xx / network errors. Throws ApiFailure. */
async function getComposition(brId: string, deps: FetchBattleDeps): Promise<Body> {
  for (let attempt = 1; ; attempt++) {
    let res: Response | null = null
    try {
      res = await deps.fetch(`${BR_COMPOSITION}/${brId}`, {
        headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
      })
    } catch {
      // network error: treated like a 5xx below
    }
    if (res && res.status === 404) throw new ApiFailure('br_not_found', `battle report ${brId} not found`)
    if (res && res.status < 500) {
      let body: unknown
      try {
        body = await res.json()
      } catch {
        throw new ApiFailure('br_not_found', `battle report ${brId} returned an invalid body`)
      }
      if (!res.ok) throw new ApiFailure('br_not_found', `battle report ${brId}: HTTP ${res.status}`)
      if (body && typeof body === 'object' && (body as { status?: unknown }).status === 'processing') {
        return { kind: 'processing' }
      }
      return { kind: 'ok', body }
    }
    if (attempt >= MAX_ATTEMPTS) {
      throw new ApiFailure('br_unavailable', `br.evetools.org unavailable (${res ? `HTTP ${res.status}` : 'network error'})`)
    }
    await deps.sleep(BACKOFF_MS * 2 ** (attempt - 1))
  }
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
  let raw: unknown
  for (let waited = 0; ; waited += POLL_MS) {
    const r = await getComposition(brId, deps)
    if (r.kind === 'ok') {
      raw = r.body
      break
    }
    if (waited >= POLL_BUDGET_MS) {
      throw new ApiFailure('br_unavailable', `battle report ${brId} is still processing`)
    }
    await deps.sleep(POLL_MS)
  }

  const c = raw as { id?: unknown; teams?: unknown; relateds?: unknown } | null
  if (!c || typeof c.id !== 'string' || !Array.isArray(c.teams) || !Array.isArray(c.relateds)) {
    throw new ApiFailure('br_not_found', `battle report ${brId} has no composition`)
  }

  let names: BattleMeta['names']
  try {
    names = await idsToNames(collectIds(raw), deps)
  } catch (e) {
    if (e instanceof EsiError) throw new ApiFailure('br_unavailable', `ESI name lookup failed: ${e.message}`)
    throw e
  }
  try {
    return normalizeBrComposition(raw, names, deps.now())
  } catch {
    throw new ApiFailure('br_not_found', `battle report ${brId} is not a valid composition`)
  }
}
