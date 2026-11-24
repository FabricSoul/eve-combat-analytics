import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, PointerEvent, ReactNode } from 'react'
import type { Analysis, EntityKey, Killmail } from '@/core/contract'
import { portraitUrl, typeRenderUrl } from '@/app/lib/images'
import { sideColor, sideLetter } from '@/app/lib/sides'
import { maxZoom, minZoom, projectPoint, zoomStep } from './camera'
import { useReplayCamera } from './useReplayCamera'
import { Bracket } from '@/app/ui/Bracket'
import { Portrait } from '@/app/ui/Portrait'
import { usePilotMenu } from '../roster/PilotActions'
import { ReplayOverlays } from './ReplayOverlays'
import { useReplayKeyboard, type ReplayFocusTarget } from './keyboard'
import { makePainter, missedTracerAt, type MissTracer, type PaintedModule, type ReplayFrame } from './paint'
import type { Point } from './layout-effects'
import { createProjectilePlayback } from './projectile'
import { placePilotLabel } from './placement'
import { watchLabelObstacles } from './label-obstacles'
import { deathAt, recentEngagement } from './presence'
import type { Rect } from './placement'
import { buildScene, makeLayout } from './scene'
import type { ReplayLayout, ReplayNode } from './scene'
import './replay.css'

function moduleAt(modules: readonly PaintedModule[], point: Point) {
  for (let index = modules.length - 1; index >= 0; index--) {
    const { rect: { x, y, width, height }, name } = modules[index]!
    if (point.x >= x && point.x <= x + width && point.y >= y && point.y <= y + height) return name
  }
}

interface ReplayStageProps extends Omit<ReplayFrame, 'reducedMotion' | 'pausedElapsed'> {
  analysis: Analysis
  headerActions?: ReactNode
  stage?: boolean
  closeFights?: ReactNode
  fightTime?: ReactNode
  killmails: readonly Killmail[]
  order: readonly number[]
  select: (key: EntityKey) => void
  getTime?: () => number
}

interface PilotMarkerProps {
  node: ReplayNode
  selected: boolean
  register: (key: EntityKey, element: HTMLDivElement | null) => void
  onInspect: (key: EntityKey | null) => void
  onSelect: (key: EntityKey) => void
}

const PilotMarker = memo(function PilotMarker({ node, selected, register, onInspect, onSelect }: PilotMarkerProps) {
  const menu = usePilotMenu()
  const { entity: { key, name, charId, hasLog, side }, color, radius, ship, shipId, letter } = node
  const label = charId === null ? ship ?? name : name

  return (
    <div ref={(element) => { register(key, element) }} className="replay-marker" data-pilot-key={key} data-selected={selected} inert
      data-unassigned={side === -1 || undefined}
      style={{ '--replay-side': color, '--replay-diameter': `${radius * 2}px` } as CSSProperties}>
      <button type="button" tabIndex={-1} className="replay-pilot" data-log={hasLog} aria-pressed={selected}
        aria-label={ship && ship !== label ? `${label} · ${ship}` : label}
        onContextMenu={(event) => menu?.open(key, event)} onPointerEnter={() => onInspect(key)} onPointerLeave={() => onInspect(null)} onClick={() => onSelect(key)}>
        {shipId !== null && (
          <img key={shipId} data-src={typeRenderUrl(shipId, radius * 2)} alt="" draggable={false}
            onLoad={(event) => { event.currentTarget.dataset.loaded = '' }}
            onError={(event) => { event.currentTarget.hidden = true }} />
        )}
        <span className="replay-hull" aria-hidden="true" />
        <span className="replay-death-mark" aria-hidden="true">×</span>
        {letter && <span className="replay-side-letter" aria-hidden="true">{letter}</span>}
        <span className="app-image app-portrait replay-pilot-portrait" aria-hidden="true">
          {charId !== null && <img data-src={portraitUrl(charId, 16)} width={16} height={16} alt="" draggable={false}
            onError={(event) => { event.currentTarget.hidden = true }} />}
        </span>
      </button>
    </div>
  )
})

function ReplayLegend({ analysis, order }: Pick<ReplayStageProps, 'analysis' | 'order'>) {
  if (order.length === 0) return null
  const coverage = analysis.coverage.find(({ side }) => side === order[0])
  return (
    <div className="replay-legend">
      <span>
        <i style={{ background: sideColor(order[0]!, order) }} />
        我方{coverage && <> · <span className="replay-number">{coverage.withLog}/{coverage.known}</span> 人有日志</>}
      </span>
      {order.length === 2 ? (
        <span className="replay-legend-enemy">
          <span>敌方 <span className="replay-legend-detail">· 来自我方日志和击毁报告</span></span>
          <i style={{ background: sideColor(order[1]!, order) }} />
        </span>
      ) : order.slice(1).map((side, index) => (
        <span key={side}><i style={{ background: sideColor(side, order) }} />{index === 0 ? '敌方' : `${sideLetter(side, order) ?? 'C'} 方`}</span>
      ))}
    </div>
  )
}

export function ReplayStage({ analysis, headerActions, stage, closeFights, fightTime, killmails, order, select, t, playing, getTime, selected, focusOnly }: ReplayStageProps) {
  const host = useRef<HTMLDivElement>(null)
  const { camera, zoom, reset, handlers } = useReplayCamera(host)
  const under = useRef<HTMLCanvasElement>(null)
  const over = useRef<HTMLCanvasElement>(null)
  const bracket = useRef<HTMLDivElement>(null)
  const tooltip = useRef<HTMLDivElement>(null)
  const effectTooltip = useRef<HTMLDivElement>(null)
  const missTracers = useRef<readonly MissTracer[]>([])
  const paintedModules = useRef<readonly PaintedModule[]>([])
  const pointer = useRef<(Point & { overPilot: boolean }) | null>(null)
  const markers = useRef(new Map<EntityKey, HTMLDivElement>())
  const labelElements = useRef(new Map<EntityKey, HTMLSpanElement>())
  const previousLayout = useRef<ReplayLayout | null>(null)
  const invalidate = useRef<() => void>(() => {})
  const [playback] = useState(createProjectilePlayback)
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 })
  const { width, height, dpr } = size
  const [inspected, inspect] = useState<EntityKey | null>(null)
  const { toolbar, focused, updateTargets, onFocus, onBlur, onKeyDown } = useReplayKeyboard()
  const scene = useMemo(() => buildScene(analysis, killmails, order), [analysis, killmails, order])
  const layout = useMemo(() => (
    width && height ? makeLayout(scene.pilots, order, width, height) : null
  ), [scene, order, width, height])
  const lockedKey = focused ?? selected
  const menu = usePilotMenu()
  const detailKey = menu?.active ? null : inspected ?? focused ?? selected
  const detail = detailKey ? layout?.byKey.get(detailKey) : undefined
  const frame = useRef({ t, playing, selected, focusOnly, detailKey, lockedKey, camera })
  const pauseClock = useRef<{ t: number; playing: boolean; since: number } | null>(null)

  const register = useCallback((key: EntityKey, element: HTMLDivElement | null) => {
    if (element) markers.current.set(key, element)
    else markers.current.delete(key)
  }, [])

  const updateEffectTooltip = useCallback((stageWidth: number) => {
    const tip = effectTooltip.current
    const point = pointer.current
    if (!tip) return
    const missed = point && !point.overPilot && missedTracerAt(missTracers.current, point)
    const label = point && (missed ? '未命中' : moduleAt(paintedModules.current, point))
    tip.toggleAttribute('data-positioned', Boolean(label))
    if (!label || !point) return
    if (tip.textContent !== label) tip.textContent = label
    if (missed) {
      const x = Math.max(4, Math.min(stageWidth - 52, point.x + 10))
      const y = point.y >= 28 ? point.y - 26 : point.y + 10
      tip.style.transform = `translate3d(${x}px, ${y}px, 0)`
      return
    }
    const left = point.x > stageWidth / 2
    const above = point.y >= 75
    tip.style.transform = `translate3d(${point.x + (left ? -10 : 10)}px, ${point.y + (above ? -8 : 10)}px, 0) translate(${left ? '-100%' : '0'}, ${above ? '-100%' : '0'})`
  }, [])

  function movePointer(event: PointerEvent<HTMLDivElement>) {
    handlers.onPointerMove(event)
    const target = event.target as Element
    if (event.pointerType === 'touch' || event.buttons || menu?.active
      || !event.currentTarget.contains(target) || target.closest('.replay-header, .replay-stage-zoom')) {
      pointer.current = null
    } else {
      const { left, top } = event.currentTarget.getBoundingClientRect()
      pointer.current = { x: event.clientX - left, y: event.clientY - top, overPilot: Boolean(target.closest('.replay-pilot')) }
    }
    updateEffectTooltip(width)
  }

  useLayoutEffect(() => {
    if (!selected) inspect(null)
  }, [selected])

  useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    function resize() {
      const next = { width: element!.clientWidth, height: element!.clientHeight, dpr: window.devicePixelRatio || 1 }
      setSize((previous) => previous.width === next.width && previous.height === next.height && previous.dpr === next.dpr ? previous : next)
    }
    resize()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(resize)
    observer?.observe(element)
    window.addEventListener('resize', resize)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', resize)
    }
  }, [])

  useLayoutEffect(() => {
    if (!layout) return
    const element = host.current
    const lineCanvas = under.current?.getContext('2d')
    const effectsCanvas = over.current?.getContext('2d')
    if (!element || !lineCanvas || !effectsCanvas) return
    const previous = previousLayout.current
    const continued = previous?.width === width && previous.height === height
      && previous.ours === layout.ours && previous.split === layout.split
    if (continued && previous !== layout) layout.inheritPositions(previous)
    previousLayout.current = layout
    lineCanvas.setTransform(dpr, 0, 0, dpr, 0, 0)
    effectsCanvas.setTransform(dpr, 0, 0, dpr, 0, 0)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let animation: number | null = null
    let disposed = false
    let firstFrame = true
    let paintedCamera = frame.current.camera
    let tooltipKey: EntityKey | null | undefined
    let tooltipWidth = 0
    let tooltipHeight = 0
    let labelSizes = new WeakMap<HTMLElement, Pick<Rect, 'width' | 'height'>>()
    let labelKey = ''
    const markerPositions = new WeakMap<HTMLElement, Point>()

    function schedule() {
      if (!disposed && animation === null) animation = requestAnimationFrame(draw)
    }

    let overlayRects: Rect[] | null = null
    const obstacles = watchLabelObstacles(element, () => {
      overlayRects = null
      labelKey = ''
      schedule()
    })
    const painter = makePainter(lineCanvas, effectsCanvas, element, schedule, playback)
    void document.fonts?.ready.then(() => {
      labelSizes = new WeakMap()
      labelKey = ''
      tooltipKey = undefined
      schedule()
    })
    function appearanceChanged() {
      painter.refreshTokens()
      schedule()
    }
    const appearanceObserver = new MutationObserver(appearanceChanged)
    appearanceObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-appearance'] })
    reduced.addEventListener('change', schedule)
    invalidate.current = schedule

    function draw() {
      animation = null
      if (!layout) return
      const { detailKey, lockedKey, camera, ...current } = frame.current
      const { playing, selected } = current
      const t = playing && getTime ? getTime() : current.t
      const cameraChanged = paintedCamera !== camera
      paintedCamera = camera
      bracket.current?.toggleAttribute('data-camera-change', cameraChanged)
      overlayRects ??= obstacles.measure()
      const now = performance.now()
      let pause = pauseClock.current
      if (!pause || pause.t !== t || pause.playing !== playing) {
        pause = { t, playing, since: now }
        pauseClock.current = pause
      }
      const pausedElapsed = playing ? 0 : now - pause.since
      const reducedMotion = reduced.matches
      const recent = recentEngagement(scene.edges, t)
      const present = new Set(scene.visibleAt(t, selected, recent))
      for (const key of playback.endpoints(t, playing)) present.add(key)
      const opponents = scene.recentOpponents(recent)
      if (detailKey !== tooltipKey) {
        tooltipKey = detailKey
        tooltipWidth = tooltip.current?.offsetWidth ?? 0
        tooltipHeight = tooltip.current?.offsetHeight ?? 0
      }

      const live = painter.liveEdges(scene.edges, t)
      layout.placeVisible(present, live)
      layout.placeUnassigned(present)
      const { related, positions, bounds, misses, modules, animating, burst } = painter.paint(
        layout, live, scene.pointSpans, present, { ...current, t, reducedMotion, pausedElapsed }, width, height, camera,
      )
      missTracers.current = misses
      paintedModules.current = modules
      if (pointer.current) updateEffectTooltip(width)
      let bursting = false
      const labels: { element: HTMLElement; node: ReplayNode; center: Point; priority: number; required: boolean }[] = []
      let nextLabelKey = `${camera.x}|${camera.y}|${camera.scale}|${detailKey}`
      const focusTargets: ReplayFocusTarget[] = []
      const previouslyFocused = document.activeElement
      for (const node of layout.nodes) {
        const { key, side } = node.entity
        const marker = markers.current.get(key)
        if (!marker) continue
        const position = positions.get(node)
        const visibilityChanged = marker.hasAttribute('data-present') !== Boolean(position)
        if (visibilityChanged) {
          marker.toggleAttribute('data-present', Boolean(position))
          marker.inert = !position
        }
        const label = labelElements.current.get(key)
        if (!position) {
          label?.removeAttribute('data-positioned')
          continue
        }
        if (firstFrame || visibilityChanged) {
          for (const image of marker.querySelectorAll<HTMLImageElement>('img[data-src]:not([src])')) {
            if (image.dataset.src) image.src = image.dataset.src
          }
        }

        const button = marker.firstElementChild
        if (button instanceof HTMLButtonElement) focusTargets.push({ key, button })
        const { x, y } = position
        const lastLoss = deathAt(node.deaths, t)
        const keep = selected === null || selected === key || related.has(key)
        const previous = markerPositions.get(marker)
        if (x !== previous?.x || y !== previous.y) {
          // Keep moving pilots in the stage's paint layer instead of promoting each pilot.
          marker.style.transform = `translate(${x}px, ${y}px)`
          markerPositions.set(marker, position)
        }
        if (side === -1) marker.style.setProperty('--replay-diameter', `${node.radius * 2}px`)
        marker.toggleAttribute('data-dead', lastLoss !== undefined)
        marker.toggleAttribute('data-dim', !keep)
        if (lastLoss && burst?.(position, node.radius, t - lastLoss.t + pausedElapsed)) bursting = true

        if (key === lockedKey && bracket.current) {
          const inset = node.radius + 7
          bracket.current.style.setProperty('--replay-lock-size', `${2 * inset}px`)
          bracket.current.style.transform = `translate3d(${x - inset}px, ${y - inset}px, 0)`
          if (!bracket.current.hasAttribute('data-positioned')) {
            // Commit the initial position before enabling movement between targets.
            void bracket.current.offsetWidth
            bracket.current.setAttribute('data-positioned', '')
          }
        }
        if (label) {
          label.toggleAttribute('data-dim', !keep)
          const inset = node.radius + 2
          const inView = x + inset > 0 && x - inset < width && y + inset > 0 && y - inset < height
          if (inView) {
            const priority = key === selected || key === detailKey ? 3 : node.entity.hasLog ? 2 : opponents.has(key) ? 1 : 0
            const center = projectPoint(camera, node)
            labels.push({ element: label, node, center, priority, required: priority >= 2 || camera.scale >= 1.5 })
            nextLabelKey += `|${node.ordinal}:${node.x}:${node.y}:${node.radius}:${priority}:${key === selected}`
          } else label.removeAttribute('data-positioned')
        }
      }

      updateTargets(focusTargets, selected, previouslyFocused)
      const lockedNode = lockedKey ? layout.byKey.get(lockedKey) : undefined
      if (!lockedNode || !positions.has(lockedNode)) bracket.current?.removeAttribute('data-positioned')

      const detailNode = detailKey ? layout.byKey.get(detailKey) : undefined
      const detailPosition = detailNode && positions.get(detailNode)
      let tooltipRect: Rect | null = null
      if (tooltip.current && detailPosition) {
        const { x, y } = detailPosition
        const tooltipX = Math.max(4, Math.min(width - tooltipWidth - 4, x - tooltipWidth / 2))
        const tooltipY = y > 118 ? y - detailNode.radius - 12 - tooltipHeight : y + detailNode.radius + 25
        tooltip.current.style.transform = `translate3d(${tooltipX}px, ${tooltipY}px, 0)`
        tooltip.current.toggleAttribute('data-positioned', true)
        tooltipRect = { x: tooltipX, y: tooltipY, width: tooltipWidth, height: tooltipHeight }
      } else {
        tooltip.current?.removeAttribute('data-positioned')
      }

      // Stable ship coordinates keep the label layout out of the transient effect draw.
      if (nextLabelKey !== labelKey) {
        labelKey = nextLabelKey
        const occupied = [...overlayRects]
        if (tooltipRect) occupied.push(tooltipRect)
        // Keep compact overview labels out of the other fleet. The empty space
        // between fleets can hold labels from either side.
        const split = camera.scale === 1 ? layout.split : null
        const span = split === 'x' ? 'width' : 'height'
        const min = split ? bounds[split] : 0
        const max = min + bounds[span]
        let ourEdge = min
        let enemyEdge = max
        for (const { node, center: { x, y } } of labels) {
          const inset = node.radius + 2
          const ring = { x: x - inset, y: y - inset, width: inset * 2 + (node.letter ? 7 : 0), height: inset * 2 }
          const badge = { x: x - node.radius - 6, y: y + node.radius - 12, width: 18, height: 18 }
          occupied.push(ring, badge)
          if (!split || node.entity.side < 0) continue
          if (node.entity.side === layout.ours) {
            ourEdge = Math.max(ourEdge, ring[split] + ring[span], badge[split] + badge[span])
          } else {
            enemyEdge = Math.min(enemyEdge, ring[split], badge[split])
          }
        }
        const ourBounds = { ...bounds, [span]: enemyEdge - min }
        const enemyBounds = split ? { ...bounds, [split]: ourEdge, [span]: max - ourEdge } : bounds
        for (const { element } of labels) {
          if (!labelSizes.has(element)) labelSizes.set(element, { width: element.offsetWidth, height: element.offsetHeight })
        }
        for (const { element, node, center, required } of labels.sort((a, b) => b.priority - a.priority)) {
          const labelBounds = !split || node.entity.side < 0 ? bounds : node.entity.side === layout.ours ? ourBounds : enemyBounds
          const rect = placePilotLabel(center, node.radius, labelSizes.get(element)!, labelBounds, occupied, required)
          element.toggleAttribute('data-positioned', rect !== null)
          if (!rect) continue
          element.style.transform = `translate(${rect.x}px, ${rect.y}px)`
          occupied.push(rect)
        }
      }
      firstFrame = false
      if (playing ? getTime !== undefined : !reducedMotion && (animating || bursting)) schedule()
    }

    draw()
    return () => {
      disposed = true
      if (animation !== null) cancelAnimationFrame(animation)
      invalidate.current = () => {}
      appearanceObserver.disconnect()
      obstacles.disconnect()
      reduced.removeEventListener('change', schedule)
    }
  }, [layout, scene, width, height, dpr, getTime, playback, updateTargets, updateEffectTooltip])

  useLayoutEffect(() => {
    frame.current = { t, playing, selected, focusOnly, detailKey, lockedKey, camera }
    invalidate.current()
  }, [t, playing, selected, focusOnly, detailKey, lockedKey, camera])

  const pilotMarkers = useMemo(() => layout?.nodes.map((node) => (
    <PilotMarker key={node.entity.key} node={node} selected={selected === node.entity.key}
      register={register} onInspect={inspect} onSelect={select} />
  )), [layout, register, select, selected])
  const pilotLabels = useMemo(() => layout?.nodes.map(({ entity: { key, name, charId }, ship }) => (
    <span key={`${key}:${key === selected}`} className="replay-pilot-label" data-pilot-label={key}
      data-selected={key === selected || undefined} data-inspected={key === detailKey || undefined}
      ref={(element) => {
        if (element) labelElements.current.set(key, element)
        else labelElements.current.delete(key)
      }}>
      <span>{charId === null ? ship ?? name : name}</span>
    </span>
  )), [detailKey, layout, selected])

  const locked = lockedKey ? layout?.byKey.get(lockedKey) : undefined

  const zoomControls = <div className="replay-zoom" role="group" aria-label="回放缩放">
    <button type="button" title="缩小" aria-label="缩小" disabled={camera.scale <= minZoom} onClick={() => zoom(1 / zoomStep)}>−</button>
    {stage && <span className="replay-number">{Math.round(camera.scale * 100)}%</span>}
    <button type="button" title="放大" aria-label="放大" disabled={camera.scale >= maxZoom} onClick={() => zoom(zoomStep)}>+</button>
    <button type="button" onClick={reset}>适应全部</button>
  </div>
  return (
    <div ref={host} className="replay-stage" data-zoomed={camera.scale > 1 || undefined} {...handlers}
      onPointerMove={movePointer} onPointerLeave={() => { pointer.current = null; updateEffectTooltip(width) }}>
      <canvas ref={under} width={Math.round(width * dpr)} height={Math.round(height * dpr)} className="replay-layer" aria-hidden="true" />
      <div ref={toolbar} role="toolbar" aria-label="回放飞行员" tabIndex={-1}
        onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown}>
        {pilotMarkers}
      </div>
      <div className="replay-name-layer" aria-hidden="true">{pilotLabels}</div>
      <canvas ref={over} width={Math.round(width * dpr)} height={Math.round(height * dpr)} className="replay-layer replay-effects" aria-hidden="true" />
      <div ref={effectTooltip} className="replay-miss-tooltip" role="tooltip" />
      {locked && (
        <div ref={bracket} className="replay-lock">
          <Bracket />
        </div>
      )}
      <div className="replay-header">
        <ReplayLegend analysis={analysis} order={order} />
        <div className="replay-header-actions">
          <ReplayOverlays stage={host} closeFights={closeFights} fightTime={fightTime} />
          {headerActions}
          {!stage && zoomControls}
        </div>
      </div>
      {stage && <div className="replay-stage-zoom">{zoomControls}</div>}
      {detail && (
        <div ref={tooltip} className="replay-tooltip" role="tooltip">
          <Portrait charId={detail.entity.charId} size={32} />
          <div><strong>{detail.entity.name}</strong><span>{detail.ship ?? '舰船未知'}</span></div>
        </div>
      )}
    </div>
  )
}
