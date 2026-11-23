import { useId, useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import type { Analysis, BattleSummary } from '@/core/contract'
import { fmtHms, fmtNum } from '../lib/format'
import { sideColor, sideLetter } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { usePlayback, useView, type LayerId } from '../state/view-store'
import { Button } from '../ui/Button'
import { Portrait } from '../ui/Portrait'
import { useTimelineGestures } from './timeline/gestures'
import { clamp, nextEvent, pointed, repairs, second, timelineData, timelineLayout, timelineSides } from './timeline/model'
import { Plot } from './timeline/Plot'
import './timeline/timeline.css'

export interface TimelineProps {
  compact?: boolean
}

function Dot({ color }: { color: string }) {
  return <i aria-hidden="true" className="eca-timeline-dot" style={{ backgroundColor: color }} />
}

function LayerChip({ label, on, toggle, children, disabled }: {
  label: string
  on: boolean
  toggle: () => void
  children?: ReactNode
  disabled?: boolean
}) {
  return <button type="button" className="eca-timeline-chip" aria-pressed={on} onClick={toggle} disabled={disabled}>
    {children}{label}
  </button>
}

function Controls({ view, next, canPlay }: {
  view: ReturnType<typeof useView> & ReturnType<typeof usePlayback>; next: number | undefined; canPlay: boolean
}) {
  const nextSpeed = { 1: 2, 2: 4, 4: 8, 8: 1 } as const
  return <div className="eca-timeline-controls" role="group" aria-label="回放控制">
    <Button variant="primary" onClick={view.playing ? view.pause : view.play} disabled={!canPlay}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        {view.playing ? <path d="M9 5v14m6-14v14" /> : <path d="m8 5 12 7-12 7z" strokeLinejoin="round" />}
      </svg>
      {view.playing ? '暂停' : '播放'}
    </Button>
    <Button aria-label="下一事件" title="下一事件" disabled={next === undefined}
      onClick={() => { if (next !== undefined) view.seek(next) }}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="m5 5 12 7-12 7zM19 5v14" strokeLinejoin="round" />
      </svg>
    </Button>
    <Button onClick={() => view.setSpeed(nextSpeed[view.speed])} title="回放倍速">{view.speed}×</Button>
    <time className="app-number eca-timeline-clock">{fmtHms(view.t)}</time>
  </div>
}

function TimelineRoom({ compact, summary, analysis }: {
  compact: boolean
  summary: BattleSummary
  analysis: Analysis | null
}) {
  const view = { ...useView(), ...usePlayback() }
  const { layers, oursSide } = view
  const [hidden, setHidden] = useState<ReadonlySet<number>>(() => new Set())
  const data = useMemo(() => timelineData(summary, analysis, oursSide), [summary, analysis, oursSide])
  const order = useMemo(() => timelineSides(summary, analysis, oursSide), [summary, analysis, oursSide])
  const curves = useMemo(() => order.map((side, i) => {
    const letter = sideLetter(side, order)
    const label = i === 0 ? '我方' : i === 1 ? '敌方' : `${letter ?? 'C'} 方`
    const layer: LayerId | undefined = i === 0 ? 'dmgOurs' : i === 1 ? 'dmgTheirs' : undefined
    return {
      side, label, layer, color: sideColor(side, order), dash: letter ? `${i + 2} ${2 + i % 3}` : undefined,
      samples: data.damage.get(side) ?? [],
    }
  }), [order, data.damage])
  const damage = useMemo(() => curves.filter(({ side, layer }) =>
    compact || (layer ? layers.has(layer) : !hidden.has(side))), [curves, compact, layers, hidden])
  const layout = useMemo(() => timelineLayout(compact, layers, damage.length > 0), [compact, layers, damage.length])
  const left = compact ? 8 : 72
  const right = compact ? 8 : 12
  const tipId = useId()
  const { chart, width, start, end, readout, focusReadout, range, events } = useTimelineGestures(data.full, left, right, view)
  const seriesEnd = analysis?.interactions.at(-1)?.t ?? data.start
  const showRepair = !compact && layers.has('repOurs')
  const showPoint = !compact && layers.has('point')
  const repair = useMemo(() => showRepair ? repairs(analysis, oursSide, data.start, seriesEnd) : [],
    [showRepair, analysis, oursSide, data.start, seriesEnd])
  const point = useMemo(() => {
    if (!showPoint) return []
    const pointEnd = analysis?.ewarSpans.reduce((end, span) => Math.max(end, span.end), seriesEnd) ?? seriesEnd
    return pointed(analysis, oursSide, data.start, Math.min(data.full[1], pointEnd))
  }, [showPoint, analysis, oursSide, data.start, data.full, seriesEnd])

  const plotWidth = Math.max(1, width - left - right)
  const x = (time: number) => left + plotWidth * (time - start) / (end - start)
  const bottom = layout.height - (compact ? 2 : 16)
  const rangeStart = range ? Math.max(range[0], start) : 0
  const rangeEnd = range ? Math.min(range[1], end) : 0
  const cursorOnPlot = view.t >= start && view.t <= end
  const readoutOnPlot = readout !== null && readout >= start && readout <= end
  const readoutBucket = readoutOnPlot ? Math.floor((readout - (analysis?.timeline.start ?? data.start)) / second) : -1
  // Reconstructed target spans can overlap at a switch. Prefer the newer call.
  const primary = readoutOnPlot ? data.primaries.reduce<(typeof data.primaries)[number] | undefined>((current, target) =>
    target.start <= readout && target.end >= readout && (!current || current.start <= target.start) ? target : current,
  undefined) : undefined
  const primaryEntity = primary ? analysis?.entities[primary.target] : undefined

  function toggleSide(side: number, layer: LayerId | undefined) {
    if (layer) return view.toggleLayer(layer)
    setHidden((previous) => {
      const next = new Set(previous)
      if (next.has(side)) next.delete(side)
      else next.add(side)
      return next
    })
  }

  function layerChip(id: LayerId, label: string, color?: string, disabled?: boolean) {
    return <LayerChip label={label} on={layers.has(id) && !disabled} disabled={disabled} toggle={() => view.toggleLayer(id)}>
      {color && <Dot color={color} />}
    </LayerChip>
  }

  return <div className="eca-timeline" data-compact={compact}>
    <div className="eca-timeline-bar">
      <Controls view={view} next={nextEvent(data.eventTimes, view.t)} canPlay={data.eventTimes.length > 0} />
      {!compact && <div className="eca-timeline-layers" role="group" aria-label="时间轴图层">
        {curves.map(({ side, layer, label, color }) => <LayerChip key={side} label={`${label}伤害`}
          on={layer ? layers.has(layer) : !hidden.has(side)} toggle={() => toggleSide(side, layer)}><Dot color={color} /></LayerChip>)}
        {layerChip('primary', '主目标')}
        {layerChip('repOurs', '我方维修', 'var(--color-repair)')}
        {layerChip('point', '点人')}
        {layerChip('kills', '击毁')}
        {layerChip('killIcons', '击毁用舰船图标', undefined, !layers.has('kills'))}
      </div>}
    </div>
    <div className="eca-timeline-plot">
      <svg ref={chart} data-timeline-chart="" data-domain-start={start} data-domain-end={end}
        width="100%" height={layout.height} viewBox={`0 0 ${width} ${layout.height}`}
        role="slider" tabIndex={0} aria-label="回放时间" aria-valuemin={Math.floor(start)} aria-valuemax={Math.ceil(end)}
        aria-keyshortcuts="Shift+ArrowLeft Shift+ArrowRight Shift+ArrowUp Shift+ArrowDown Escape"
        aria-describedby={focusReadout && readoutOnPlot ? tipId : undefined}
        aria-valuenow={Math.round(clamp(view.t, start, end))} aria-valuetext={fmtHms(view.t)} {...events}>
        <Plot width={width} height={layout.height} left={left} right={right} start={start} end={end}
          bucketStart={data.start} lanes={layout.lanes} compact={compact} zoomed={end - start < data.full[1] - data.full[0]}
          killIcons={layout.killIcons} summary={summary} analysis={analysis} order={order} damage={damage} repair={repair}
          point={point} primaries={data.primaries} />
        <g pointerEvents="none">
          {range && rangeEnd >= rangeStart && <rect x={x(rangeStart)} y="4" width={Math.max(1, x(rangeEnd) - x(rangeStart))}
            height={Math.max(1, bottom - 6)} fill="var(--color-sel)" stroke="var(--color-accent-line)" strokeDasharray="3 3" />}
          {readoutOnPlot && <line x1={x(readout)} x2={x(readout)} y1="2" y2={bottom} stroke="var(--color-text-3)" />}
          {cursorOnPlot && <line x1={x(view.t)} x2={x(view.t)} y1="2" y2={bottom} stroke="var(--color-accent-line)" strokeWidth="2" />}
        </g>
      </svg>
      {readoutOnPlot && <div id={tipId} className="eca-timeline-tip" role="tooltip" style={{ '--hover-x': `${x(readout)}px` } as CSSProperties}>
        <time className="app-number">{fmtHms(readout)}</time>
        {damage.map((curve) => <div key={curve.side} data-readout-side={curve.side} className="eca-timeline-readout">
          <Dot color={curve.color} /><span>{curve.label}</span>
          <b className="app-number">{fmtNum(analysis?.timeline.damageBySide[curve.side]?.[readoutBucket] ?? 0)}</b><span>/秒</span>
        </div>)}
        {primary ? <div className="eca-timeline-target">
          <span>主目标</span><Portrait charId={primaryEntity?.charId ?? null} size={16} />
          <span>{primaryEntity?.name ?? primary.target}</span><b className="app-number">{fmtNum(primary.shooters.length)}</b><span>人</span>
        </div> : <div>这一秒没有主目标</div>}
      </div>}
    </div>
  </div>
}

export function Timeline({ compact = false }: TimelineProps) {
  const { summary, analysis } = useBattleContext()
  return summary && <TimelineRoom key={summary.meta.brId} compact={compact} summary={summary} analysis={analysis} />
}
