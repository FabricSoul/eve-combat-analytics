import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import type { Analysis, BattleSummary } from '@/core/contract'
import { fmtHms, fmtNum } from '../lib/format'
import { sideColor, sideLetter } from '../lib/sides'
import { useBattleContext } from '../state/battle-store'
import { usePlayback, useView, type LayerId, type TimeRange } from '../state/view-store'
import { Button } from '../ui/Button'
import { Portrait } from '../ui/Portrait'
import { rangeLabel } from './RangeChip'
import { useTimelineGestures } from './timeline/gestures'
import { clamp, nextEvent, plotScale, pointed, repairs, second, timelineData, timelineLayout, timelineSides } from './timeline/model'
import { PilotLanes } from './timeline/PilotLanes'
import { Plot } from './timeline/Plot'
import { TimelineHelp, useCoarsePointer, useTimelineHint } from './timeline/TimelineHelp'
import { TimelineRange } from './timeline/TimelineRange'
import './timeline/timeline.css'

export interface TimelineProps {
  compact?: boolean
  separateLanes?: boolean
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

function Controls({ view, next, skip, canPlay, compact, draft, activity, touchRange }: {
  view: ReturnType<typeof useView> & ReturnType<typeof usePlayback>; next: number | undefined; canPlay: boolean; compact: boolean
  skip: () => void
  draft: TimeRange | null
  activity: TimeRange
  touchRange: boolean
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
      onClick={skip}>
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="m5 5 12 7-12 7zM19 5v14" strokeLinejoin="round" />
      </svg>
      {!compact && '下一事件'}
    </Button>
    <Button onClick={() => view.setSpeed(nextSpeed[view.speed])} title="回放倍速">{view.speed}×</Button>
    <time className="app-number eca-timeline-clock">{fmtHms(view.t)}</time>
    {draft ? <span className="battle-range-draft">{rangeLabel(draft)}</span>
      : (view.range || touchRange) && <TimelineRange range={view.range} bounds={activity} cursor={view.t}
        setRange={view.setRange} clearRange={view.clearRange} />}
  </div>
}

function TimelinePlayhead({ width, left, right, start, end, bottom }: {
  width: number; left: number; right: number; start: number; end: number; bottom: number
}) {
  const { t } = usePlayback()
  if (t < start || t > end) return null
  const x = plotScale(width, left, right, start, end)(t)
  return <line x1={x} x2={x} y1="2" y2={bottom} stroke="var(--color-accent)" strokeWidth="2" />
}

function TimelineRoom({ compact, separateLanes, summary, analysis }: {
  compact: boolean
  separateLanes: boolean
  summary: BattleSummary
  analysis: Analysis | null
}) {
  const view = { ...useView(), ...usePlayback('coarse') }
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
  const layout = useMemo(() => timelineLayout(compact, layers, damage.length > 0, separateLanes),
    [compact, layers, damage.length, separateLanes])
  const left = compact ? 8 : 72
  const right = compact ? 8 : 12
  const tipId = useId()
  const { showHint, dismissHint } = useTimelineHint()
  const coarsePointer = useCoarsePointer()
  const touchRange = compact || coarsePointer
  const activity = data.activity ?? data.full
  const { chart, width, start, end, readout, focusReadout, range, draft, events } =
    useTimelineGestures(data.full, left, right, view, dismissHint, activity)
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

  const x = plotScale(width, left, right, start, end)
  const bottom = layout.height - (compact ? 2 : 16)
  const rangeStart = range ? Math.max(range[0], start) : 0
  const rangeEnd = range ? Math.min(range[1], end) : 0
  const brush = range && rangeEnd >= rangeStart
    ? { x: x(rangeStart), width: Math.max(1, x(rangeEnd) - x(rangeStart)) }
    : null
  const cursorX = view.t >= start && view.t <= end ? x(view.t) : null
  const readoutOnPlot = readout !== null && readout >= start && readout <= end
  const readoutBucket = readoutOnPlot ? Math.floor((readout - (analysis?.timeline.start ?? data.start)) / second) : -1
  // Reconstructed target spans can overlap at a switch. Prefer the newer call.
  const primary = readoutOnPlot ? data.primaries.reduce<(typeof data.primaries)[number] | undefined>((current, target) =>
    target.start <= readout && target.end >= readout && (!current || current.start <= target.start) ? target : current,
  undefined) : undefined
  const primaryEntity = primary ? analysis?.entities[primary.target] : undefined
  function nextAt(time: number) {
    const event = nextEvent(data.eventTimes, time)
    return event !== undefined && (!view.range || event <= view.range[1]) ? event : undefined
  }

  function skip() {
    const next = nextAt(view.getTime())
    if (next !== undefined) view.seek(next)
  }

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

  const hint = showHint && !touchRange && <div className="eca-timeline-hint">
      <span>Shift+拖动可以只看一段</span>
      <Button variant="ghost" aria-label="关闭时间轴提示" onClick={(event) => {
        dismissHint()
        if (event.detail === 0) chart.current?.focus({ preventScroll: true })
      }}>×</Button>
    </div>

  return <div className="eca-timeline" data-compact={compact} data-workspace={separateLanes || undefined}>
    <div className="eca-timeline-bar">
      <Controls view={view} next={nextAt(view.t)} skip={skip} canPlay={data.eventTimes.length > 0} compact={compact}
        draft={draft} activity={activity} touchRange={touchRange} />
      {separateLanes && hint}
      <div className="eca-timeline-options">
        {!compact && <div className="eca-timeline-layers" role="group" aria-label="时间轴图层">
          {curves.map(({ side, layer, label, color }) => <LayerChip key={side} label={`${label}伤害`}
            on={layer ? layers.has(layer) : !hidden.has(side)} toggle={() => toggleSide(side, layer)}><Dot color={color} /></LayerChip>)}
          {layerChip('primary', '主目标')}
          {layerChip('repOurs', '我方维修', 'var(--color-repair)')}
          {layerChip('point', '点人')}
          {layerChip('kills', '击毁')}
          {layerChip('killIcons', '击毁用舰船图标', undefined, !layers.has('kills'))}
        </div>}
        <TimelineHelp touchRange={touchRange} />
      </div>
    </div>
    {!separateLanes && hint}
    <div className="eca-timeline-plot">
      <svg ref={chart} data-timeline-chart="" data-domain-start={start} data-domain-end={end} data-range-draft={draft ? '' : undefined}
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
          {brush && <rect x={brush.x} y="4" width={brush.width}
            height={Math.max(1, bottom - 6)} fill="var(--color-sel)" stroke="var(--color-accent-line)" strokeDasharray="3 3" />}
          {readoutOnPlot && <line x1={x(readout)} x2={x(readout)} y1="2" y2={bottom} stroke="var(--color-text-3)" />}
          <TimelinePlayhead width={width} left={left} right={right} start={start} end={end} bottom={bottom} />
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
    {!compact && !separateLanes && <PilotLanes analysis={analysis} logs={summary.logs} oursSide={oursSide} sideOrder={order}
      pinned={view.pinned} onRemove={view.togglePin} width={width} left={left} right={right} start={start} end={end}
      cursorX={cursorX} brush={brush} />}
  </div>
}

export function Timeline({ compact = false, separateLanes = false }: TimelineProps) {
  const { summary, analysis } = useBattleContext()
  return summary && <TimelineRoom key={summary.meta.brId} compact={compact} separateLanes={separateLanes} summary={summary} analysis={analysis} />
}

export function PilotTimelineModule() {
  const { summary, analysis } = useBattleContext()
  const { oursSide, pinned, togglePin, range } = useView()
  const { t } = usePlayback('coarse')
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(300)
  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const measure = () => setWidth(Math.max(220, element.clientWidth))
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(measure)
    observer?.observe(element)
    return () => observer?.disconnect()
  }, [])
  const data = useMemo(() => summary ? timelineData(summary, analysis, oursSide) : null, [summary, analysis, oursSide])
  const order = useMemo(() => summary ? timelineSides(summary, analysis, oursSide) : [], [summary, analysis, oursSide])
  const [start, end] = data?.full ?? [0, 1]
  const x = plotScale(width, 82, 10, start, end)
  const brush = range ? { x: x(range[0]), width: x(range[1]) - x(range[0]) } : null
  return <div ref={ref}>{summary && <PilotLanes analysis={analysis} logs={summary.logs} oursSide={oursSide}
    sideOrder={order} pinned={pinned} onRemove={togglePin} width={width} left={82} right={10} start={start} end={end}
    cursorX={t >= start && t <= end ? x(t) : null} brush={brush} />}</div>
}
