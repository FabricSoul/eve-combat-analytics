import type { Analysis, EntityKey } from '@/core/contract'
import { centeredDamageMean, second } from './model'

export type PilotMetric = 'damageOut' | 'damageIn' | 'repairOut'

export interface PilotSeries {
  samples: readonly number[]
  peak: number
}

export function createPilotSeries(analysis: Analysis, oursLogIds: ReadonlySet<string>) {
  const { entities, interactions, timeline } = analysis
  const length = interactions.length
    ? Math.max(0, Math.floor((interactions.at(-1)!.t - timeline.start) / second) + 1)
    : 0
  const cache = new Map<PilotMetric, Map<EntityKey, PilotSeries>>()

  return (keys: readonly EntityKey[], metric: PilotMetric) => {
    const saved = cache.get(metric) ?? new Map<EntityKey, PilotSeries>()
    const missing = new Map<EntityKey, { samples: number[]; observed: boolean }>()
    for (const key of keys) {
      const entity = entities[key]
      if (entity && !saved.has(key)) missing.set(key, { samples: Array<number>(length).fill(0), observed: !entity.hasLog })
    }
    if (missing.size && length) {
      const repair = metric === 'repairOut'
      const wantedKind = repair ? 'repair' : 'damage'
      const incoming = metric === 'damageIn'
      for (const event of interactions) {
        if (event.kind !== wantedKind || (repair && event.repairType === 'capacitor')) continue
        const series = missing.get(incoming ? event.to : event.from)
        if (!series || (series.observed && !event.sources.some(({ logId }) => oursLogIds.has(logId)))) continue
        const i = Math.floor((event.t - timeline.start) / second)
        if (series.samples[i] !== undefined) series.samples[i] += event.amount
      }
    }
    for (const [key, raw] of missing) {
      const samples = centeredDamageMean(raw.samples)
      const peak = samples.reduce((max, amount) => Math.max(max, amount), 0)
      saved.set(key, { samples, peak })
    }
    cache.set(metric, saved)

    const result = new Map<EntityKey, PilotSeries>()
    for (const key of keys) {
      const series = saved.get(key)
      if (series) result.set(key, series)
    }
    return result
  }
}
