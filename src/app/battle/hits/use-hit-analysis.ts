import { useMemo } from 'react'
import type { EntityKey } from '@/core/contract'
import { useBattleContext } from '../../state/battle-store'
import { useView } from '../../state/view-store'
import { aggregateHits } from './analysis'

export function useHitAnalysis() {
  const { analysis, summary } = useBattleContext()
  const { oursSide, range } = useView()
  const logs = summary?.logs
  return useMemo(() => {
    if (!analysis || !logs) return null
    const uploaders = new Set<EntityKey>(logs.map(({ charId }): EntityKey => `char:${charId}`))
    return aggregateHits(analysis.entities, analysis.interactions, uploaders, oursSide, range)
  }, [analysis, logs, oursSide, range])
}
