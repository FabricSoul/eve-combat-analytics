import { memo, useId, useMemo, useState } from 'react'
import type { Analysis, BattleSummary, EntityKey } from '@/core/contract'
import { fmtNum } from '@/app/lib/format'
import { sideColor } from '@/app/lib/sides'
import { useView } from '@/app/state/view-store'
import { noPilotLogReason, observedHint, observedLabel } from '../compare/metrics'
import { observedPilots } from '../compare/observations'
import { PilotMore, usePilotMenu } from '../roster/PilotActions'
import { Portrait } from '@/app/ui/Portrait'
import { Curve } from './Plot'
import { plotScale } from './model'
import { createPilotSeries, type PilotMetric, type PilotSeries } from './pilot-series'

const height = 46
const lane = { top: 0, height }
const metrics = [
  ['damageOut', '输出'], ['damageIn', '承伤'], ['repairOut', '维修输出'],
] as const

interface Geometry {
  width: number
  left: number
  right: number
  start: number
  end: number
}

interface PilotLanesProps extends Geometry {
  analysis: Analysis | null
  logs: BattleSummary['logs']
  oursSide: number
  sideOrder: readonly number[]
  pinned: ReadonlySet<EntityKey>
  onRemove(key: EntityKey): void
  cursorX: number | null
  brush: { x: number; width: number } | null
}

const PilotTrace = memo(function PilotTrace({ geometry, bucketStart, color, series }: {
  geometry: Geometry; bucketStart: number; color: string; series: PilotSeries
}) {
  const id = useId()
  const { width, left, right, start, end } = geometry
  const x = plotScale(width, left, right, start, end)
  return <>
    <defs><clipPath id={id}><rect x={left} y="0" width={Math.max(1, width - left - right)} height={height} /></clipPath></defs>
    <g clipPath={`url(#${id})`}>
      <Curve x={x} start={start} end={end} bucketStart={bucketStart} lane={lane}
        samples={series.samples} stroke={color} max={Math.max(1, series.peak)} area />
    </g>
  </>
})

export function PilotLanes({ analysis, logs, sideOrder, pinned, onRemove, cursorX, brush, width, left, right, start, end }: PilotLanesProps) {
  const { selected, select } = useView()
  const menu = usePilotMenu()
  const [metric, setMetric] = useState<PilotMetric>('damageOut')
  const geometry = useMemo(() => ({ width, left, right, start, end }), [width, left, right, start, end])
  const seriesFor = useMemo(() => analysis && createPilotSeries(analysis, new Set(logs.map(({ id }) => id))), [analysis, logs])
  const observed = useMemo(() => analysis && observedPilots(analysis.interactions, analysis.ewarSpans), [analysis])
  const series = useMemo(() => seriesFor?.([...pinned], metric), [seriesFor, pinned, metric])

  return <section className="eca-pilot-lanes" aria-label="按人对比">
    <header className="eca-pilot-lanes-header">
      <span>按人对比</span>
      <div className="eca-pilot-metrics" role="group" aria-label="时间轴按人对比指标">
        {metrics.map(([value, label]) => <button key={value} type="button" aria-pressed={metric === value}
          onClick={() => setMetric(value)}>{label}</button>)}
      </div>
    </header>
    {analysis && series?.size ? <div className="eca-pilot-lanes-scroll" tabIndex={0} role="group" aria-label="勾选的飞行员">
      {[...series].map(([key, data]) => {
        const pilot = analysis.entities[key]
        if (!pilot) return null
        const color = metric === 'repairOut' ? 'var(--color-repair)' : sideColor(pilot.side, sideOrder)
        const hasObservation = !pilot.hasLog && observed?.has(key)
        const hasMeasurement = pilot.hasLog || hasObservation
        const peak = hasMeasurement ? `峰值 ${fmtNum(Math.round(data.peak))}/秒` : '峰值 —'
        return <div key={key} data-pilot-lane={key} className="eca-pilot-lane" style={{ width }}
          data-selected={selected === key || undefined} onContextMenu={(event) => menu?.open(key, event)}>
          <div className="eca-pilot-cell" style={{ width: left }}>
            <button type="button" className="eca-pilot-select" aria-pressed={selected === key} title={pilot.name} onClick={() => select(key)}>
              <Portrait charId={pilot.charId} size={16} />
              <span className="eca-pilot-name">{pilot.name}</span>
            </button>
            {menu ? <PilotMore pilot={key} name={pilot.name} /> : <button type="button" className="eca-pilot-remove" aria-label={`移除 ${pilot.name} 的时间轴对比`}
              onClick={() => onRemove(key)}>×</button>}
            {hasObservation && <span className="eca-pilot-observed" title={observedHint}>{observedLabel}</span>}
          </div>
          <svg className="eca-pilot-chart" width={width} height={height} viewBox={`0 0 ${width} ${height}`}
            role="img" aria-label={`${pilot.name} · ${peak}`}>
            {hasMeasurement
              ? <PilotTrace geometry={geometry} bucketStart={analysis.timeline.start} color={color} series={data} />
              : <title>{noPilotLogReason}</title>}
            {brush && <rect x={brush.x} y="1" width={brush.width} height={height - 2}
              fill="var(--color-sel)" stroke="var(--color-accent-line)" strokeDasharray="3 3" />}
            {cursorX !== null && <line x1={cursorX} x2={cursorX} y1="0" y2={height}
              stroke="var(--color-accent)" strokeWidth="2" />}
            <text x={width - right} y="12" textAnchor="end" className="eca-pilot-peak">{peak}</text>
          </svg>
        </div>
      })}
    </div> : <p className="eca-pilot-empty">在名单或对比里勾选飞行员，会出现在这里</p>}
  </section>
}
