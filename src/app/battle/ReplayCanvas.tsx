import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { EntityKey, Killmail } from '@/core/contract'
import { sideOrder } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { usePlayback, useView } from '../state/view-store'
import { ReplayStage } from './replay/ReplayStage'

export interface ReplayCanvasProps {}

const noKillmails: readonly Killmail[] = []

export function ReplayCanvas(_props: ReplayCanvasProps) {
  const { analysis, summary, status } = useBattleContext()
  const { selected, focusOnly, oursSide, select } = useView()
  const { t, playing } = usePlayback()
  const selectRef = useRef(select)
  useLayoutEffect(() => { selectRef.current = select }, [select])
  const selectPilot = useCallback((key: EntityKey) => selectRef.current(key), [])
  const order = useMemo(() => analysis ? sideOrder(analysis, oursSide) : [], [analysis, oursSide])

  if (!analysis) {
    return <div className="replay-status" role="status">{status === 'error' ? '无法加载回放' : '正在加载回放…'}</div>
  }

  if (!analysis.interactions.length) {
    return <div className="replay-status" role="status">当前日志中没有战斗交互</div>
  }

  return <ReplayStage analysis={analysis} killmails={summary?.meta.killmails ?? noKillmails}
    order={order} select={selectPilot} t={t} playing={playing} selected={selected} focusOnly={focusOnly} />
}
