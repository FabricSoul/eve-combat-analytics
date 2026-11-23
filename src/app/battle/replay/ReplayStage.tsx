import { memo, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import type { Analysis, EntityKey, Killmail } from '@/core/contract'
import { typeRenderUrl } from '@/app/lib/images'
import { sideColor, sideLetter } from '@/app/lib/sides'
import { Bracket } from '@/app/ui/Bracket'
import { Portrait } from '@/app/ui/Portrait'
import { useReplayKeyboard, type ReplayFocusTarget } from './keyboard'
import { makePainter } from './paint'
import type { ReplayFrame } from './paint'
import { placePilotLabel } from './placement'
import { deathAt, recentEngagement } from './presence'
import type { Rect } from './placement'
import { buildScene, makeLayout } from './scene'
import type { ReplayLayout, ReplayNode } from './scene'
import './replay.css'

interface ReplayStageProps extends Omit<ReplayFrame, 'reducedMotion'> {
  analysis: Analysis
  killmails: readonly Killmail[]
  order: readonly number[]
  select: (key: EntityKey) => void
}

interface PilotMarkerProps {
  node: ReplayNode
  selected: boolean
  inspected: boolean
  labelEligible: boolean
  register: (key: EntityKey, element: HTMLDivElement | null) => void
  onInspect: (key: EntityKey | null) => void
  onSelect: (key: EntityKey) => void
}

const PilotMarker = memo(function PilotMarker({ node, selected, inspected, labelEligible, register, onInspect, onSelect }: PilotMarkerProps) {
  const { entity: { key, name, charId, hasLog, side }, color, radius, ship, shipId, letter } = node

  return (
    <div ref={(element) => { register(key, element) }} className="replay-marker" data-selected={selected} inert
      data-unassigned={side === -1 || undefined}
      style={{ '--replay-side': color, '--replay-diameter': `${radius * 2}px` } as CSSProperties}>
      <button type="button" tabIndex={-1} className="replay-pilot" data-log={hasLog} aria-pressed={selected}
        aria-label={ship ? `${name} · ${ship}` : name}
        onPointerEnter={() => onInspect(key)} onPointerLeave={() => onInspect(null)} onClick={() => onSelect(key)}>
        {shipId !== null && (
          <img key={shipId} data-src={typeRenderUrl(shipId, radius * 2)} alt="" draggable={false}
            onLoad={(event) => { event.currentTarget.dataset.loaded = '' }}
            onError={(event) => { event.currentTarget.hidden = true }} />
        )}
        <span className="replay-hull" aria-hidden="true" />
        <span className="replay-death-mark" aria-hidden="true">×</span>
        {letter && <span className="replay-side-letter" aria-hidden="true">{letter}</span>}
      </button>
      {(selected || inspected || labelEligible) && (
        <span key={selected ? 'selected' : 'plain'} className="replay-pilot-label" aria-hidden="true">
          {selected && <Portrait charId={charId} size={16} />}
          <span>{name}</span>
        </span>
      )}
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

export function ReplayStage({ analysis, killmails, order, select, t, playing, selected, focusOnly }: ReplayStageProps) {
  const host = useRef<HTMLDivElement>(null)
  const under = useRef<HTMLCanvasElement>(null)
  const over = useRef<HTMLCanvasElement>(null)
  const bracket = useRef<HTMLDivElement>(null)
  const tooltip = useRef<HTMLDivElement>(null)
  const markers = useRef(new Map<EntityKey, HTMLDivElement>())
  const previousLayout = useRef<ReplayLayout | null>(null)
  const invalidate = useRef<() => void>(() => {})
  const [size, setSize] = useState({ width: 0, height: 0, dpr: 1 })
  const { width, height, dpr } = size
  const [inspected, inspect] = useState<EntityKey | null>(null)
  const { toolbar, focused, updateTargets, onFocus, onBlur, onKeyDown } = useReplayKeyboard()
  const scene = useMemo(() => buildScene(analysis, killmails, order), [analysis, killmails, order])
  const layout = useMemo(() => (
    width && height ? makeLayout(scene.pilots, order, width, height) : null
  ), [scene, order, width, height])
  const lockedKey = focused ?? selected
  const detailKey = inspected ?? focused ?? selected
  const detail = detailKey ? layout?.byKey.get(detailKey) : undefined
  const frame = useRef({ t, playing, selected, focusOnly, detailKey, lockedKey })

  const register = useCallback((key: EntityKey, element: HTMLDivElement | null) => {
    if (element) markers.current.set(key, element)
    else markers.current.delete(key)
  }, [])

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
    const continued = previous?.width === width && previous.height === height && previous.ours === layout.ours
    if (continued && previous !== layout) layout.inheritPositions(previous)
    previousLayout.current = layout
    lineCanvas.setTransform(dpr, 0, 0, dpr, 0, 0)
    effectsCanvas.setTransform(dpr, 0, 0, dpr, 0, 0)
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    let animation: number | null = null
    let disposed = false
    let lastLayoutTime: number | null = null
    let lastLayoutSelection: EntityKey | null = null
    let lastFocusOnly = false
    let tooltipKey: EntityKey | null | undefined
    let tooltipWidth = 0
    let tooltipHeight = 0
    let labelSizes = new WeakMap<HTMLElement, Pick<Rect, 'width' | 'height'>>()

    function schedule() {
      if (!disposed && animation === null) animation = requestAnimationFrame(draw)
    }

    const painter = makePainter(lineCanvas, effectsCanvas, element, schedule)
    void document.fonts?.ready.then(() => {
      labelSizes = new WeakMap()
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
      const { detailKey, lockedKey, ...current } = frame.current
      const { t, playing, selected, focusOnly } = current
      const reducedMotion = reduced.matches
      const recent = recentEngagement(scene.edges, t)
      const present = scene.visibleAt(t, selected, recent)
      const opponents = scene.recentOpponents(recent)
      const membershipChanged = layout.setVisible(present)
      const layoutTime = playing ? Math.floor(t / 250) * 250 : t
      const firstFrame = lastLayoutTime === null
      if (membershipChanged || layoutTime !== lastLayoutTime || selected !== lastLayoutSelection || focusOnly !== lastFocusOnly) {
        const inheritedFrame = firstFrame && continued
        layout.engage(scene.edges, t, selected, focusOnly, !inheritedFrame || playing)
        // A live refresh starts from the current coordinates. Only a new viewport settles in a batch.
        if (!inheritedFrame) layout.tick(firstFrame ? 145 : 1)
        lastLayoutTime = layoutTime
        lastLayoutSelection = selected
        lastFocusOnly = focusOnly
      } else if (!reducedMotion && layout.isMoving()) {
        layout.tick()
      }

      if (detailKey !== tooltipKey) {
        tooltipKey = detailKey
        tooltipWidth = tooltip.current?.offsetWidth ?? 0
        tooltipHeight = tooltip.current?.offsetHeight ?? 0
      }

      const live = painter.liveEdges(scene.edges, t)
      layout.placeUnassigned(present)
      const { related, positions, occupied, bounds, burst } = painter.paint(
        layout, live, scene.pointSpans, present, { ...current, reducedMotion }, width, height,
      )
      const labels: { element: HTMLElement; node: ReplayNode; priority: number }[] = []
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
        if (!position) continue
        if (firstFrame || visibilityChanged) {
          const image = marker.querySelector<HTMLImageElement>('img[data-src]:not([src])')
          if (image?.dataset.src) image.src = image.dataset.src
        }

        const button = marker.firstElementChild
        if (button instanceof HTMLButtonElement) focusTargets.push({ key, button })
        const { x, y } = position
        const lastLoss = deathAt(node.deaths, t)
        const keep = selected === null || selected === key || related.has(key)
        marker.style.transform = `translate3d(${x}px, ${y}px, 0)`
        if (side === -1) marker.style.setProperty('--replay-diameter', `${node.radius * 2}px`)
        marker.toggleAttribute('data-dead', lastLoss !== undefined)
        marker.toggleAttribute('data-dim', !keep)
        if (lastLoss && t - lastLoss.t < 920) burst?.(position, node.radius, t - lastLoss.t)

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
        const label = marker.querySelector<HTMLElement>('.replay-pilot-label')
        if (label) {
          if (key === selected || key === detailKey || (height >= 420 && (node.entity.hasLog || opponents.has(key)))) {
            labels.push({ element: label, node, priority: key === selected ? 2 : key === detailKey ? 1 : 0 })
          } else label.removeAttribute('data-positioned')
        }
      }

      updateTargets(focusTargets, selected, previouslyFocused)
      const lockedNode = lockedKey ? layout.byKey.get(lockedKey) : undefined
      if (!lockedNode || !positions.has(lockedNode)) bracket.current?.removeAttribute('data-positioned')

      const detailNode = detailKey ? layout.byKey.get(detailKey) : undefined
      const detailPosition = detailNode && positions.get(detailNode)
      if (tooltip.current && detailPosition) {
        const { x, y } = detailPosition
        const tooltipX = Math.max(4, Math.min(width - tooltipWidth - 4, x - tooltipWidth / 2))
        const tooltipY = y > 118 ? y - detailNode.radius - 12 - tooltipHeight : y + detailNode.radius + 25
        tooltip.current.style.transform = `translate3d(${tooltipX}px, ${tooltipY}px, 0)`
        tooltip.current.toggleAttribute('data-positioned', true)
        occupied.push({ x: tooltipX, y: tooltipY, width: tooltipWidth, height: tooltipHeight })
      } else {
        tooltip.current?.removeAttribute('data-positioned')
      }

      // Read new label sizes together before writing their positions.
      for (const { element } of labels) {
        if (!labelSizes.has(element)) labelSizes.set(element, { width: element.offsetWidth, height: element.offsetHeight })
      }
      for (const { element, node, priority } of labels.sort((a, b) => b.priority - a.priority)) {
        const center = positions.get(node)!
        const rect = placePilotLabel(center, node.radius, labelSizes.get(element)!, bounds, occupied, priority > 0)
        element.toggleAttribute('data-positioned', rect !== null)
        if (!rect) continue
        element.style.transform = `translate3d(${rect.x - center.x}px, ${rect.y - center.y}px, 0)`
        occupied.push(rect)
      }
      if (!reducedMotion && layout.isMoving()) schedule()
    }

    draw()
    return () => {
      disposed = true
      if (animation !== null) cancelAnimationFrame(animation)
      invalidate.current = () => {}
      appearanceObserver.disconnect()
      reduced.removeEventListener('change', schedule)
    }
  }, [layout, scene, width, height, dpr, updateTargets])

  useLayoutEffect(() => {
    frame.current = { t, playing, selected, focusOnly, detailKey, lockedKey }
    invalidate.current()
  }, [t, playing, selected, focusOnly, detailKey, lockedKey])

  const locked = lockedKey ? layout?.byKey.get(lockedKey) : undefined

  return (
    <div ref={host} className="replay-stage">
      <canvas ref={under} width={Math.round(width * dpr)} height={Math.round(height * dpr)} className="replay-layer" aria-hidden="true" />
      <div ref={toolbar} role="toolbar" aria-label="回放飞行员" tabIndex={-1}
        onFocus={onFocus} onBlur={onBlur} onKeyDown={onKeyDown}>
        {layout?.nodes.map((node) => (
          <PilotMarker key={node.entity.key} node={node} selected={selected === node.entity.key} inspected={detailKey === node.entity.key}
            labelEligible={height >= 420 && (node.entity.hasLog || (node.entity.side >= 0 && node.entity.side !== order[0]))}
            register={register} onInspect={inspect} onSelect={select} />
        ))}
      </div>
      <canvas ref={over} width={Math.round(width * dpr)} height={Math.round(height * dpr)} className="replay-layer replay-effects" aria-hidden="true" />
      {locked && (
        <div ref={bracket} className="replay-lock">
          <Bracket />
        </div>
      )}
      <ReplayLegend analysis={analysis} order={order} />
      {detail && (
        <div ref={tooltip} className="replay-tooltip" role="tooltip">
          <Portrait charId={detail.entity.charId} size={32} />
          <div><strong>{detail.entity.name}</strong><span>{detail.ship ?? '舰船未知'}</span></div>
        </div>
      )}
    </div>
  )
}
