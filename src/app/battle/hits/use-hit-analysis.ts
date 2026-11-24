import type { Analysis, BattleSummary, EntityKey } from '@/core/contract'
import { useBattleContext } from '../../state/battle-store'
import { useView, type TimeRange } from '../../state/view-store'
import { aggregateHits } from './analysis'

const snapshots = new WeakMap<Analysis, {
  logs: BattleSummary['logs']
  oursSide: number
  range: TimeRange | null
  hits: ReturnType<typeof aggregateHits>
}>()

export function useHitAnalysis() {
  const { analysis, summary } = useBattleContext()
  const { oursSide, range } = useView()
  const logs = summary?.logs
  if (!analysis || !logs) return null
  const previous = snapshots.get(analysis)
  if (previous?.logs === logs && previous.oursSide === oursSide &&
      previous.range?.[0] === range?.[0] && previous.range?.[1] === range?.[1]) return previous.hits
  const uploaders = new Set<EntityKey>(logs.map(({ charId }): EntityKey => `char:${charId}`))
  const hits = aggregateHits(analysis.entities, analysis.interactions, uploaders, oursSide, range)
  snapshots.set(analysis, { logs, oursSide, range, hits })
  return hits
}
