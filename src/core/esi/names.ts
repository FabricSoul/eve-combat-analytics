import type { Affiliation, BattleMeta } from '../contract'
import { EsiError, esiRequest, type EsiDeps } from './client'

const IDS_TO_NAMES_CHUNK = 1000
const NAMES_TO_IDS_CHUNK = 500
const AFFILIATION_CHUNK = 1000

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

/** ESI answers 404 for the whole chunk if any id is unknown: bisect until the bad ids are alone, then drop them. */
async function namesChunk(ids: number[], deps: EsiDeps, into: BattleMeta['names']): Promise<void> {
  try {
    const rows = await esiRequest<{ id: number; name: string; category: string }[]>(deps, 'POST', '/universe/names/', ids)
    for (const r of rows) into[r.id] = { name: r.name, category: r.category }
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
  const out: Record<string, number | null> = {}
  for (const c of chunks([...new Set(names)], NAMES_TO_IDS_CHUNK)) {
    const res = await esiRequest<{ characters?: { id: number; name: string }[] }>(deps, 'POST', '/universe/ids/', c)
    const byLower = new Map<string, number>()
    for (const ch of res.characters ?? []) byLower.set(ch.name.toLowerCase(), ch.id)
    for (const n of c) out[n] = byLower.get(n.toLowerCase()) ?? null
  }
  return out
}

export async function affiliations(charIds: number[], deps: EsiDeps): Promise<Affiliation[]> {
  const out: Affiliation[] = []
  for (const c of chunks([...new Set(charIds)], AFFILIATION_CHUNK)) {
    const rows = await esiRequest<{ character_id: number; corporation_id: number; alliance_id?: number }[]>(
      deps,
      'POST',
      '/characters/affiliation/',
      c,
    )
    for (const r of rows) out.push({ charId: r.character_id, corpId: r.corporation_id, allyId: r.alliance_id ?? null })
  }
  return out
}
