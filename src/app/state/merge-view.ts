import type { Analysis, Entity, EntityKey, IdentityMerge, PilotStats } from '@/core/contract'

type Intent = { from: EntityKey; to: IdentityMerge['to'] }

const additive = ['damageOut', 'damageIn', 'repairOut', 'repairIn', 'neutOut', 'neutIn', 'misses', 'pointSeconds', 'killmailDamage', 'killmailCount'] as const

/**
 * The analysis as the server will have it once it has applied these merges: the unidentified entity's interactions,
 * spans, primaries and stats move onto the character. Medians and ratios stay the character's own until the real
 * analysis arrives. A merge whose entity is not in the analysis (already folded, or unknown) is skipped.
 */
export function foldIdentities(analysis: Analysis, merges: readonly Intent[]): Analysis {
  const into = new Map<EntityKey, EntityKey>()
  for (const { from, to } of merges) if (analysis.entities[from] && analysis.entities[to]) into.set(from, to)
  if (into.size === 0) return analysis
  const rekey = (key: EntityKey) => into.get(key) ?? key

  const entities: Record<EntityKey, Entity> = {}
  for (const [key, entity] of Object.entries(analysis.entities) as [EntityKey, Entity][]) {
    if (!into.has(key)) entities[key] = entity
  }
  for (const [from, to] of into) {
    const target = entities[to]!
    const extra = analysis.entities[from]!.shipTypes.filter((ship) => !target.shipTypes.includes(ship))
    if (extra.length) entities[to] = { ...target, shipTypes: [...target.shipTypes, ...extra] }
  }

  const stats = new Map<EntityKey, PilotStats>()
  for (const entry of analysis.stats) {
    if (!into.has(entry.key)) stats.set(entry.key, entry)
  }
  for (const [from, to] of into) {
    const source = analysis.stats.find((entry) => entry.key === from)
    const target = stats.get(to)
    if (!source || !target) continue
    const sum: PilotStats = { ...target }
    for (const key of additive) sum[key] = target[key] + source[key]
    sum.hitQuality = { ...target.hitQuality }
    for (const [quality, n] of Object.entries(source.hitQuality) as [keyof PilotStats['hitQuality'], number][]) {
      sum.hitQuality[quality] = (sum.hitQuality[quality] ?? 0) + n
    }
    stats.set(to, sum)
  }

  return {
    ...analysis,
    entities,
    interactions: analysis.interactions.map((event) => {
      const from = rekey(event.from)
      const to = rekey(event.to)
      return from === event.from && to === event.to ? event : { ...event, from, to }
    }),
    ewarSpans: analysis.ewarSpans.map((span) => ({ ...span, from: rekey(span.from), to: rekey(span.to) })),
    primaries: analysis.primaries.map((primary) => ({
      ...primary, target: rekey(primary.target), shooters: [...new Set(primary.shooters.map(rekey))].sort(),
    })),
    stats: analysis.stats.flatMap((entry) => stats.get(entry.key) ?? []),
  }
}
