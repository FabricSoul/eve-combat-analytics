import { useCallback, useLayoutEffect, useMemo, useRef } from 'react'
import type { EntityKey, Killmail } from '@/core/contract'
import { sideOrder } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { useCoarseTime, usePlayback, useView } from '../state/view-store'
import { ReplayNoiseControls, useNoiseFilteredAnalysis } from './replay/noise'
import { ReplayStage } from './replay/ReplayStage'
import { fmtHms, fmtNum } from '../lib/format'
import { Who } from './feed/Who'
import { buildFeed } from './feed/model'

export interface ReplayCanvasProps { stage?: boolean }

function CloseFights({ analysis, order }: { analysis: NonNullable<ReturnType<typeof useBattleContext>['analysis']>; order: number[] }) {
  const { summary } = useBattleContext()
  const { oursSide, selected } = useView()
  const t = useCoarseTime()
  const rows = useMemo(() => summary ? buildFeed({
    analysis, summary, mode: 'merged', t, oursSide, kinds: ['damage'], focus: null, range: null,
  }).slice(0, 4) : [], [summary, analysis, t, oursSide])
  if (!summary) return null
  return <details open className="replay-close-fights">
    <summary title="展开或收起此刻交火">此刻交火 <span>{fmtHms(t)} · 前 10 秒</span></summary>
    {rows.length ? <table><thead><tr><th>出手</th><th>对象</th><th>伤害</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.id} data-selected={selected !== null && (row.from === selected || row.to === selected) ? '' : undefined}>
        <td><Who entityKey={row.from} analysis={analysis} summary={summary} order={order} /></td>
        <td><Who entityKey={row.to} analysis={analysis} summary={summary} order={order} /></td>
        <td className="app-number">{fmtNum(row.total)}</td>
      </tr>)}</tbody></table> : <p>拖动时间轴查看交火</p>}
  </details>
}

const noKillmails: readonly Killmail[] = []

export function ReplayCanvas({ stage }: ReplayCanvasProps) {
  const { analysis, summary, status } = useBattleContext()
  const { selected, focusOnly, oursSide, select } = useView()
  const { t, playing } = usePlayback()
  const visibleAnalysis = useNoiseFilteredAnalysis(analysis)
  const selectRef = useRef(select)
  useLayoutEffect(() => { selectRef.current = select }, [select])
  const selectPilot = useCallback((key: EntityKey) => selectRef.current(key), [])
  const order = useMemo(() => analysis ? sideOrder(analysis, oursSide) : [], [analysis, oursSide])

  if (!analysis || !visibleAnalysis) {
    return <div className="replay-status" role="status">{status === 'error' ? '无法加载回放' : '正在加载回放…'}</div>
  }

  if (!analysis.interactions.length) {
    return <div className="replay-status" role="status">当前日志中没有战斗交互 · 上传包含战斗记录的日志</div>
  }

  return <ReplayStage stage={stage} closeFights={stage ? <CloseFights analysis={visibleAnalysis} order={order} /> : undefined} analysis={visibleAnalysis} headerActions={<ReplayNoiseControls />} killmails={summary?.meta.killmails ?? noKillmails}
    order={order} select={selectPilot} t={t} playing={playing} selected={selected} focusOnly={focusOnly} />
}
