import type { Entity, EntityKey, Interaction } from '@/core/contract'
import { upperTimeIndex } from './layout-effects'

interface PilotPresence {
  entity: Entity
  deaths: readonly { t: number }[]
}

interface PresenceSpan {
  t: number
  end: number
}

export function deathAt(deaths: readonly { t: number }[], t: number) {
  return deaths[upperTimeIndex(deaths, t) - 1]
}

export function recentEngagement(interactions: readonly Interaction[], t: number) {
  const counts = new Map<EntityKey, number>()
  for (let index = upperTimeIndex(interactions, t) - 1; index >= 0; index--) {
    const event = interactions[index]!
    if (event.t < t - 10_000) break
    counts.set(event.from, (counts.get(event.from) ?? 0) + 1)
    if (event.to !== event.from) counts.set(event.to, (counts.get(event.to) ?? 0) + 1)
  }
  return counts
}

export function makePresence(
  pilots: readonly PilotPresence[], interactions: readonly Interaction[], ours: number | undefined,
) {
  const spans = new Map<EntityKey, PresenceSpan[]>()
  function record(key: EntityKey, eventTime: number) {
    // An interaction is within [t-60 s, t+5 s] for exactly this span of t.
    const t = eventTime - 5000
    const end = eventTime + 60_000
    const ranges = spans.get(key)
    if (!ranges) {
      spans.set(key, [{ t, end }])
      return
    }
    const latest = ranges.at(-1)!
    if (t <= latest.end) latest.end = end
    else ranges.push({ t, end })
  }

  for (const { from, to, t } of interactions) {
    record(from, t)
    if (from !== to) record(to, t)
  }

  return (
    t: number, selected: EntityKey | null, recent: ReadonlyMap<EntityKey, number> = recentEngagement(interactions, t),
  ): ReadonlySet<EntityKey> => {
    const visible = new Set<EntityKey>()
    for (const { entity: { key, side, hasLog }, deaths } of pilots) {
      if (key === selected || recent.has(key)) {
        visible.add(key)
        continue
      }
      const death = deathAt(deaths, t)
      if (death) {
        if (t - death.t < 30_000) visible.add(key)
        continue
      }
      const ranges = spans.get(key)
      const active = ranges && ranges[upperTimeIndex(ranges, t) - 1]
      if ((side === ours && hasLog) || (active && t <= active.end)) visible.add(key)
    }
    return visible
  }
}
