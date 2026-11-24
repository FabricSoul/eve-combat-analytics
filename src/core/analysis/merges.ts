import type { Analysis, EntityKey, IdentityMerge } from '../contract'

export interface MergeSuggestion {
  to: IdentityMerge['to']
  shipTypes: string[]
  overlapMs: number
}

interface Activity {
  first: number
  last: number
  outgoing: Set<string>
}

function hullName(name: string): string {
  return name.trim().replace(/\*+$/, '').toLowerCase()
}

/** Rank same-side hull matches with overlapping activity and no conflicting witness. */
export function suggestMerges(analysis: Analysis, from: EntityKey): MergeSuggestion[] {
  const unidentified = analysis.entities[from]
  if (!unidentified || unidentified.charId !== null || !unidentified.shipTypes.length) return []

  const hulls = new Set(unidentified.shipTypes.map(hullName))
  const candidates = new Map<EntityKey, MergeSuggestion>()
  for (const entity of Object.values(analysis.entities)) {
    if (entity.charId === null || entity.side !== unidentified.side) continue
    const shipTypes = entity.shipTypes.filter((name) => hulls.has(hullName(name)))
    if (shipTypes.length) candidates.set(entity.key, { to: `char:${entity.charId}`, shipTypes, overlapMs: 0 })
  }
  if (!candidates.size) return []

  const activity = new Map<EntityKey, Activity>()
  function record(key: EntityKey, t: number): Activity | undefined {
    if (key !== from && !candidates.has(key)) return
    let row = activity.get(key)
    if (!row) {
      row = { first: t, last: t, outgoing: new Set() }
      activity.set(key, row)
    }
    row.last = t
    return row
  }
  for (const event of analysis.interactions) {
    if (event.from === from) candidates.delete(event.to)
    if (event.to === from) candidates.delete(event.from)
    record(event.to, event.t)
    const actor = record(event.from, event.t)
    if (actor) {
      // One witness distinguishes two sources acting in the same second.
      for (const { logId } of event.sources) actor.outgoing.add(`${Math.floor(event.t / 1000)}:${logId}`)
    }
  }

  const seen = activity.get(from)
  if (!seen) return []
  const suggestions: MergeSuggestion[] = []
  for (const [key, candidate] of candidates) {
    const other = activity.get(key)
    if (!other || [...other.outgoing].some((witness) => seen.outgoing.has(witness))) continue
    const overlapMs = Math.min(seen.last, other.last) - Math.max(seen.first, other.first)
    if (overlapMs >= 0) suggestions.push({ ...candidate, overlapMs })
  }
  return suggestions.sort((a, b) => b.overlapMs - a.overlapMs || a.to.localeCompare(b.to))
}
