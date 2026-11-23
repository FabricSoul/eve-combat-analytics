import type { Affiliation, BattleMeta } from '../contract'
import { EsiError, esiRequest, type EsiDeps } from './client'

const IDS_TO_NAMES_CHUNK = 1000
const NAMES_TO_IDS_CHUNK = 500
const AFFILIATION_CHUNK = 1000

const invalid = (route: string) => new EsiError(200, `ESI ${route}: unexpected response shape`)
const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** ESI answers 404 for the whole chunk if any id is unknown: bisect until the bad ids are alone, then drop them. */
async function namesChunk(ids: number[], deps: EsiDeps, into: BattleMeta['names']): Promise<void> {
  try {
    const rows = await esiRequest<unknown>(deps, 'POST', '/universe/names/', ids)
    if (!Array.isArray(rows)) throw invalid('/universe/names/')
    for (const r of rows) {
      if (!isRecord(r) || !isNum(r.id) || typeof r.name !== 'string' || typeof r.category !== 'string') {
        throw invalid('/universe/names/')
      }
      into[r.id] = { name: r.name, category: r.category }
    }
  } catch (e) {
    if (!(e instanceof EsiError) || e.status !== 404) throw e
    if (ids.length === 1) return
    const mid = Math.ceil(ids.length / 2)
    await namesChunk(ids.slice(0, mid), deps, into)
    await namesChunk(ids.slice(mid), deps, into)
  }
}

export async function idsToNames(ids: number[], deps: EsiDeps): Promise<BattleMeta['names']> {
  const out: BattleMeta['names'] = {}
  for (const c of chunks([...new Set(ids)], IDS_TO_NAMES_CHUNK)) await namesChunk(c, deps, out)
  return out
}

/** Character name → id (null when ESI does not know it). Keyed by the input string, not ESI's canonical spelling. */
export async function namesToCharacters(names: string[], deps: EsiDeps): Promise<Record<string, number | null>> {
  const entries: [string, number | null][] = []
  for (const c of chunks([...new Set(names)], NAMES_TO_IDS_CHUNK)) {
    const res = await esiRequest<unknown>(deps, 'POST', '/universe/ids/', c)
    if (!isRecord(res) || (res.characters !== undefined && !Array.isArray(res.characters))) {
      throw invalid('/universe/ids/')
    }
    const byLower = new Map<string, number>()
    for (const ch of (res.characters as unknown[] | undefined) ?? []) {
      if (!isRecord(ch) || !isNum(ch.id) || typeof ch.name !== 'string') throw invalid('/universe/ids/')
      byLower.set(ch.name.toLowerCase(), ch.id)
    }
    for (const n of c) entries.push([n, byLower.get(n.toLowerCase()) ?? null])
  }
  // fromEntries defines own properties, so a name like "__proto__" is an ordinary key
  return Object.fromEntries(entries)
}

export async function affiliations(charIds: number[], deps: EsiDeps): Promise<Affiliation[]> {
  const out: Affiliation[] = []
  for (const c of chunks([...new Set(charIds)], AFFILIATION_CHUNK)) {
    const rows = await esiRequest<unknown>(deps, 'POST', '/characters/affiliation/', c)
    if (!Array.isArray(rows)) throw invalid('/characters/affiliation/')
    for (const r of rows) {
      if (!isRecord(r) || !isNum(r.character_id) || !isNum(r.corporation_id) || !(r.alliance_id === undefined || isNum(r.alliance_id))) {
        throw invalid('/characters/affiliation/')
      }
      out.push({ charId: r.character_id, corpId: r.corporation_id, allyId: r.alliance_id ?? null })
    }
  }
  return out
}
