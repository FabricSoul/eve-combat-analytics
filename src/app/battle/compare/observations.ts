import type { EntityKey, EwarSpan, Interaction } from '@/core/contract'

/** Interactions are already scoped to the requested time range. */
export function observedPilots(
  interactions: readonly Interaction[],
  spans: readonly EwarSpan[],
  [from, to]: readonly [number, number] = [-Infinity, Infinity],
): ReadonlySet<EntityKey> {
  const pilots = new Set<EntityKey>()
  for (const event of interactions) {
    pilots.add(event.from)
    pilots.add(event.to)
  }
  for (const span of spans) {
    if (span.ewar !== 'warp_scramble' && span.ewar !== 'warp_disrupt') continue
    if (span.start > to || span.end < from) continue
    pilots.add(span.from)
    pilots.add(span.to)
  }
  return pilots
}
