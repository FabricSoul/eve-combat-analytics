import { memo, useId } from 'react'
import type { Analysis, BattleSummary, PrimaryTarget } from '@/core/contract'
import { sideOf } from '@/core/br/normalize'
import { fmtHms, fmtIsk } from '@/app/lib/format'
import { typeIconUrl } from '@/app/lib/images'
import { sideColor, sideLetter } from '@/app/lib/sides'
import { Portrait } from '@/app/ui/Portrait'
import { clamp, plotScale, second, type Lane } from './model'

const color = {
  hair: 'var(--color-hair)', raised: 'var(--color-raised)', surface: 'var(--color-surface)',
  repair: 'var(--color-repair)', point: 'var(--color-text-2)',
}
const tickSteps = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]

export interface DamageCurve {
  side: number
  label: string
  color: string
  dash?: string
  samples: readonly number[]
}

type XScale = (time: number) => number

interface PlotProps {
  width: number
  height: number
  left: number
  right: number
  start: number
  end: number
  bucketStart: number
  lanes: readonly Lane[]
  compact: boolean
  zoomed: boolean
  killIcons: boolean
  summary: BattleSummary
  analysis: Analysis | null
  order: readonly number[]
  damage: readonly DamageCurve[]
  repair: readonly number[]
  point: readonly number[]
  primaries: readonly PrimaryTarget[]
}

function peak(series: readonly number[]) {
  return series.reduce((maximum, value) => Math.max(maximum, value), 1)
}

export function Curve({ x, start, end, bucketStart, lane, samples, stroke, max, dash, side, area }: {
  x: XScale
  start: number
  end: number
  bucketStart: number
  lane: Pick<Lane, 'top' | 'height'>
  samples: readonly number[]
  stroke: string
  max: number
  dash?: string
  side?: number
  area?: boolean
}) {
  const first = Math.max(0, Math.floor((start - bucketStart) / second))
  const last = Math.min(samples.length - 1, Math.ceil((end - bucketStart) / second))
  if (first > last) return null
  const base = lane.top + lane.height - 2
  const y = (value: number) => base - (lane.height - 6) * value / max
  const px = (i: number) => x(bucketStart + i * second).toFixed(1)
  const points = []
  for (let i = first; i <= last; i++) points.push(`${px(i)},${y(samples[i]!).toFixed(1)}`)
  const d = `M${points.join('L')}${first === last ? 'h0.5' : ''}`
  return <>
    {area && <path d={`M${px(first)},${base}L${points.join('L')}L${px(last)},${base}Z`} fill={stroke} opacity=".3" />}
    <path data-damage-side={side} d={d} fill="none" stroke={stroke} strokeWidth="1.4" strokeDasharray={dash} />
  </>
}

function Primaries({ lane, props, x }: { lane: Lane; props: PlotProps; x: XScale }) {
  return props.primaries.map((primary) => {
    if (primary.end < props.start || primary.start > props.end) return null
    const entity = props.analysis?.entities[primary.target]
    const name = entity?.name ?? primary.target
    const from = x(Math.max(props.start, primary.start))
    const width = Math.max(1.5, x(Math.min(props.end, primary.end + second)) - from)
    const showName = props.zoomed && width >= 42
    return <g key={`${primary.bySide}-${primary.target}-${primary.start}-${primary.end}`}>
      <title>{`主目标 ${name} · ${primary.shooters.length} 人`}</title>
      <rect x={from} y={lane.top + (showName ? 0 : 2)} width={width} height={showName ? 13 : 8}
        rx="2" fill={color.raised} stroke={color.hair} />
      {showName && <foreignObject x={from + 2} y={lane.top} width={width - 4} height="13">
        <div className="eca-timeline-primary-name">
          <Portrait charId={entity?.charId ?? null} size={10} />
          <span>{name}</span>
        </div>
      </foreignObject>}
    </g>
  })
}

function KillMarks({ lane, props, x }: { lane: Lane; props: PlotProps; x: XScale }) {
  const { summary, analysis, order, killIcons, start, end } = props
  const kills = summary.meta.killmails
  const maxValue = kills.reduce((max, kill) => Math.max(max, kill.value), 1)
  const visible = kills.filter(({ t }) => t >= start && t <= end)
  if (killIcons) visible.sort((a, b) => b.value - a.value || a.id - b.id)
  const placed: { x: number; y: number; r: number }[] = []
  return visible.map(({ id, t, victim, value }) => {
    const entity = victim.charId === null ? null : analysis?.entities[`char:${victim.charId}`]
    const side = entity?.side ?? sideOf(victim, summary.meta.teams)
    const stroke = sideColor(side, order)
    const letter = sideLetter(side, order)
    const cx = x(t)
    const name = entity?.name ?? (victim.charId === null ? '未知驾驶员' : summary.meta.names[victim.charId]?.name ?? String(victim.charId))
    const ship = victim.shipTypeId === null ? '未知舰船' : summary.meta.names[victim.shipTypeId]?.name ?? String(victim.shipTypeId)
    const title = `${fmtHms(t)} ${name} · ${ship} · ${fmtIsk(value)}${letter ? ` · ${letter} 方` : ''}`
    if (!killIcons) {
      return <line key={id} x1={cx} x2={cx} y1={lane.top + 2} y2={lane.top + 12} stroke={stroke} strokeWidth="2">
        <title>{title}</title>
      </line>
    }
    const r = 5 + 9 * Math.sqrt(Math.max(0, value) / maxValue)
    let cy = lane.top + 2 + r
    for (const q of placed) {
      const gap = r + q.r + 3
      if (Math.abs(cx - q.x) < gap && Math.abs(cy - q.y) < gap) cy = q.y + gap
    }
    cy = Math.min(cy, lane.top + lane.height - r - 1)
    placed.push({ x: cx, y: cy, r })
    return <g key={id}>
      <title>{title}</title>
      <circle cx={cx} cy={cy} r={r + 1.5} fill={color.surface} stroke={stroke} strokeWidth="1.5" />
      {victim.shipTypeId !== null && <image href={typeIconUrl(victim.shipTypeId, r * 2)}
        x={cx - r} y={cy - r} width={r * 2} height={r * 2} className="eca-timeline-ship" />}
      {letter && <text x={cx + r} y={cy + r} className="eca-timeline-side-letter">{letter}</text>}
    </g>
  })
}

export const Plot = memo(function Plot(props: PlotProps) {
  const { left, right, width, height, start, end, compact, lanes, damage, repair, point, bucketStart } = props
  const clipId = useId()
  const plotWidth = Math.max(1, width - left - right)
  const x = plotScale(width, left, right, start, end)
  const damageMax = damage.reduce((max, curve) => Math.max(max, peak(curve.samples)), 1)
  const series = { repair, point }
  const pixelsPerTick = 82
  const interval = (end - start) * pixelsPerTick / plotWidth / second
  const step = second * (tickSteps.find((step) => step >= interval) ?? Math.ceil(interval / 3600) * 3600)
  const ticks = []
  for (let time = Math.ceil(start / step) * step; !compact && time <= end; time += step) {
    const center = clamp(x(time), 26, width - 26)
    const label = fmtHms(time)
    ticks.push(<text key={time} x={center} y={height - 2} className="eca-timeline-axis" textAnchor="middle">
      {step < 60 * second ? label : label.slice(0, 5)}
    </text>)
  }

  return <>
    <defs><clipPath id={clipId}><rect x={Math.max(0, left - 1)} y="0" width={plotWidth + 2} height={height} /></clipPath></defs>
    {lanes.map((lane) => {
      const { id, label, top, height } = lane
      const base = top + height - 2
      return <g key={id} data-lane={id}>
        {!compact && <text x="0" y={top + (id === 'damage' ? 30 : id === 'primary' ? 10 : id === 'kills' ? (props.killIcons ? 18 : 11) : 14)}
          className="eca-timeline-label">{label}</text>}
        {/* Icons can extend past the plot ends, so only the strokes and primary bar need clipping. */}
        <g clipPath={id === 'kills' && props.killIcons ? undefined : `url(#${clipId})`}>
          {(id === 'damage' || id === 'repair' || id === 'point') &&
            <line x1={left} x2={left + plotWidth} y1={base} y2={base} stroke={color.hair} />}
          {id === 'primary' && <Primaries lane={lane} props={props} x={x} />}
          {id === 'damage' && damage.map((curve) => <Curve key={curve.side} x={x} start={start} end={end}
            bucketStart={bucketStart} lane={lane} samples={curve.samples} stroke={curve.color}
            max={damageMax} dash={curve.dash} side={curve.side} />)}
          {(id === 'repair' || id === 'point') && <Curve x={x} start={start} end={end} bucketStart={bucketStart}
            lane={lane} samples={series[id]} stroke={color[id]} max={peak(series[id])} area />}
          {id === 'kills' && <KillMarks lane={lane} props={props} x={x} />}
        </g>
      </g>
    })}
    {ticks}
  </>
})
