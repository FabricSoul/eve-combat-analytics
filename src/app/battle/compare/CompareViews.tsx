import type { CSSProperties } from 'react'
import type { EntityKey } from '@/core/contract'
import { sideColor } from '../../lib/sides'
import { Portrait } from '../../ui/Portrait'
import { TypeIcon } from '../../ui/TypeIcon'
import {
  damageKinds, median, metricValue, missingReason, shipId, unknownDamageReason, type CompareRow, type Metric,
} from './metrics'

export interface Column {
  metric: Metric
  low: number
  high: number
  median: number | null
}

export function makeColumn(metric: Metric, rows: readonly CompareRow[]): Column {
  const values = rows.flatMap((row) => metricValue(row, metric) ?? [])
  const low = Math.min(0, ...values)
  return { metric, low, high: Math.max(low + 1, ...values), median: median(values) }
}

function position(value: number, { low, high }: Column) {
  return (value - low) / (high - low) * 100
}

export function MetricLabel({ metric }: { metric: Metric }) {
  const kind = damageKinds[metric.key as keyof typeof damageKinds]
  return <span title={metric.key === 'unknown' ? unknownDamageReason : undefined}>
    {kind?.icon && <img src={kind.icon} width="14" height="14" alt="" />} {metric.label}
  </span>
}

export function PilotName({ row, onClick }: { row: CompareRow; onClick?: () => void }) {
  const { entity } = row
  const name = <><Portrait charId={entity.charId} size={20} />
    <TypeIcon typeId={shipId(entity)} size={16} /><span className="u7-ellipsis">{entity.name}</span></>
  return onClick
    ? <button type="button" className="u7-compare-who" title={entity.name} onClick={onClick}>{name}</button>
    : <span className="u7-compare-who" title={entity.name}>{name}</span>
}

export function MetricValue({ row, metric }: { row: CompareRow; metric: Metric }) {
  const value = metricValue(row, metric)
  return value === null
    ? <span className="app-number u7-no-value" title={missingReason(row, metric)}
        aria-label={missingReason(row, metric)}>—</span>
    : <span className="app-number">{metric.format(value)}</span>
}

function MedianTick({ column }: { column: Column }) {
  const { median: middle, metric } = column
  return middle === null ? null : <span className="u7-compare-median" style={{ left: `${position(middle, column)}%` }}
    title={`全队中位 ${metric.format(middle)}`} />
}

export function MetricBar({ value, column, color }: { value: number | null; column: Column; color: string }) {
  const start = position(0, column)
  const end = value === null ? start : position(value, column)
  return <span className="u7-compare-bar">
    <i style={{ left: `${Math.min(start, end)}%`, width: `${Math.abs(end - start)}%`, background: color }} />
    <MedianTick column={column} />
  </span>
}

export function SideBySide({ rows, columns, order }: {
  rows: CompareRow[]; columns: Column[]; order: number[]
}) {
  if (!rows.length) return <p className="u7-compare-message">勾选最多 4 位飞行员进行并排对比。</p>
  return <div className="u7-compare-cards">{columns.map((column) => <section key={column.metric.key}>
    <h3><MetricLabel metric={column.metric} />
      <small>全队中位 <span className="app-number">{column.metric.format(column.median)}</span></small>
    </h3>
    {rows.map((row) => <div className="u7-compare-pair" key={row.entity.key}>
      <PilotName row={row} />
      <MetricBar column={column} value={metricValue(row, column.metric)} color={sideColor(row.entity.side, order)} />
      <MetricValue row={row} metric={column.metric} />
    </div>)}
  </section>)}</div>
}

export function Distribution({ rows, columns, pinned, order, onSelect }: {
  rows: CompareRow[]; columns: Column[]; pinned: ReadonlySet<EntityKey>; order: number[];
  onSelect(key: EntityKey): void
}) {
  return <div className="u7-distribution">{columns.map((column) => {
    const { metric, low, high } = column
    const entries = rows.flatMap((row) => {
      const value = metricValue(row, metric)
      return value === null ? [] : [{ row, value, position: position(value, column) }]
    })
    // Give each highlighted label its own lane. Dense unselected points stay on the axis.
    let nextLane = 0
    return <section className="u7-distribution-strip" key={metric.key}>
      <h3><MetricLabel metric={metric} /><small><span className="app-number">{entries.length}</span> 人有值</small></h3>
      <div className="u7-distribution-plot">
        <div className="u7-distribution-axis"><MedianTick column={column} />
          {entries.map(({ row, value, position: left }) => {
            const highlighted = pinned.has(row.entity.key)
            const lane = highlighted ? nextLane++ : 0
            const hint = `${row.entity.name} · ${metric.format(value)}`
            return <button key={row.entity.key} type="button" className="u7-distribution-point"
              data-highlighted={highlighted} data-anchor={left < 35 ? 'start' : left > 65 ? 'end' : 'middle'}
              style={{ left: `${left}%`, '--point-side': sideColor(row.entity.side, order), '--label-top': `${[-24, 22, -38, 36][lane] ?? -24}px` } as CSSProperties}
              title={hint} aria-label={hint} onClick={() => onSelect(row.entity.key)}>
              <TypeIcon typeId={shipId(row.entity)} size={16} />
              {highlighted && <span>{row.entity.name}</span>}
            </button>
          })}
        </div>
        <div className="u7-distribution-limits app-number"><span>{metric.format(low)}</span><span>{metric.format(high)}</span></div>
      </div>
    </section>
  })}</div>
}
