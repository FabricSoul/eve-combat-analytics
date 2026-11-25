import { createContext, useContext, useId, useLayoutEffect, useReducer, useRef, useState,
  type Dispatch, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { WindowFrame } from '../../shell/windows/WindowFrame'
import { windowHeight } from '../../shell/windows/layout'
import { defaultReplayOverlays, replayOverlayIds, replayOverlayReducer,
  type ReplayOverlayAction, type ReplayOverlayId, type ReplayOverlayLayout } from '../../shell/windows/replay-layout'
import { InteractionKey } from './InteractionKey'
import { placeFightsWindow, placeReplayWindow, replayWindowRegions, shortMapHeight, type Rect } from './placement'
import '../../shell/windows/windows.css'

export const ReplayOverlayWorkspace = createContext<{
  layer: HTMLElement | null
  popoverLayer: HTMLElement | null
  layout: ReplayOverlayLayout
  dispatch: Dispatch<ReplayOverlayAction>
  cancelDrag: RefObject<(() => boolean) | null>
} | null>(null)

const titles = { legend: '交互图例', fights: '此刻交火' }
const overlayGap = 8
const legendWidth = 236
const legendHeight = 424
const compactLegend = { width: 400, height: 240 }
const fightsWidth = 336
const fightsHeight = 164
const compactFightsWidth = 1200
const minPhoneFightsWidth = 188
const phoneFightsTitleLineHeight = 14
const phoneFightsFrameBorders = 2
const phoneFightsCompactHeight = 2 * phoneFightsTitleLineHeight + phoneFightsFrameBorders

// In a shallow strip, put the title bar beside the list to leave the full
// height available for scrolling rows. The collapsed window keeps its usual bar.
const phoneFightsSideTitle = [
  '[.battle-replay-overlay:has(&)]:flex-row!',
  '[.battle-replay-overlay:has(&)_.battle-window-titlebar]:relative',
  '[.battle-replay-overlay:has(&)_.battle-window-titlebar]:h-full!',
  '[.battle-replay-overlay:has(&)_.battle-window-titlebar]:w-[calc(2*var(--touch-target)+2*var(--space-2))]!',
  '[.battle-replay-overlay:has(&)_.battle-window-titlebar]:grid!',
  '[.battle-replay-overlay:has(&)_.battle-window-titlebar]:grid-cols-[repeat(2,var(--touch-target))]',
  '[.battle-replay-overlay:has(&)_.battle-window-titlebar]:place-content-center',
  '[.battle-replay-overlay:has(&)_.battle-window-titlebar]:gap-0!',
  '[.battle-replay-overlay:has(&)_.battle-window-titlebar]:border-r',
  '[.battle-replay-overlay:has(&)_.battle-window-titlebar]:border-b-0!',
  '[.battle-replay-overlay:has(&)_.battle-window-titlebar]:border-app-hair',
  '[.battle-replay-overlay:has(&)_.battle-window-titlebar]:px-0!',
  '[.battle-replay-overlay:has(&)_.battle-module-handle]:absolute',
  '[.battle-replay-overlay:has(&)_.battle-module-handle]:left-1',
  '[.battle-replay-overlay:has(&)_.battle-module-handle]:top-1',
  '[.battle-replay-overlay:has(&)_.battle-window-heading]:col-span-2',
  '[.battle-replay-overlay:has(&)_.battle-window-heading]:block!',
  '[.battle-replay-overlay:has(&)_.battle-window-heading]:text-center',
  '[.battle-replay-overlay:has(&)_.battle-window-heading]:leading-[14px]',
  '[.battle-replay-overlay:has(&)_.battle-window-subtitle]:block',
  '[.battle-replay-overlay:has(&)_.battle-window-subtitle]:ml-0!',
].join(' ')

function paddedRect({ left, top, right, bottom }: DOMRect, gap: number): Rect {
  return { x: Math.floor(left) - gap, y: Math.floor(top) - gap,
    width: Math.ceil(right) - Math.floor(left) + 2 * gap, height: Math.ceil(bottom) - Math.floor(top) + 2 * gap }
}

function sameRects(previous: readonly Rect[], next: readonly Rect[]) {
  return previous.length === next.length && next.every(({ x, y, width, height }, index) => {
    const rect = previous[index]!
    return rect.x === x && rect.y === y && rect.width === width && rect.height === height
  })
}

function phoneFightsRegion(stage: Rect, controls: readonly Rect[], minExpandedHeight: number, barHeight: number, touch: number) {
  const viewport = { x: stage.x + overlayGap, y: stage.y + overlayGap,
    width: stage.width - 2 * overlayGap, height: stage.height - 2 * overlayGap }
  const expanded = replayWindowRegions(viewport, controls, minPhoneFightsWidth, minExpandedHeight)
  const sideTitleHeight = touch + phoneFightsCompactHeight
  const compact = expanded.length ? expanded : replayWindowRegions(viewport, controls, minPhoneFightsWidth, sideTitleHeight)
  const regions = compact.length ? compact : replayWindowRegions(viewport, controls, minPhoneFightsWidth, barHeight)
  const area = (region: Rect) => Math.min(region.width, fightsWidth) * Math.min(region.height, fightsHeight)
  return regions.sort((a, b) => area(b) - area(a) || b.x + b.width - a.x - a.width || a.y - b.y).slice(0, 1)
}

export function ReplayOverlays({ stage, phone = false, closeFights, fightTime, placementTime, onLayoutChange }: {
  stage: RefObject<HTMLDivElement | null>
  phone?: boolean
  closeFights?: ReactNode
  fightTime?: ReactNode
  placementTime: number | null
  onLayoutChange: RefObject<(() => void) | null>
}) {
  const workspace = useContext(ReplayOverlayWorkspace)
  const [localLayout, localDispatch] = useReducer(replayOverlayReducer, undefined, defaultReplayOverlays)
  const { layout, dispatch } = workspace ?? { layout: localLayout, dispatch: localDispatch }
  const legendButton = useRef<HTMLButtonElement>(null)
  const fightsButton = useRef<HTMLButtonElement>(null)
  const keyboardOpen = useRef<ReplayOverlayId | null>(null)
  const baseId = useId()
  const hasFights = Boolean(closeFights)
  const [phoneFightsOpen, setPhoneFightsOpen] = useState(false)
  const [phoneFightsCollapsed, setPhoneFightsCollapsed] = useState(false)
  const [phoneFightsRect, setPhoneFightsRect] = useState<Rect | null>(null)
  const { open: fightsOpen, collapsed: fightsPreference, rect: savedFights } = layout.overlays.fights
  const [geometry, setGeometry] = useState(() => ({
    width: window.innerWidth, height: window.innerHeight, stageWidth: window.innerWidth, left: 24, legendTop: 120, mapFloor: 0,
    top: 0, barHeight: windowHeight, minExpandedFightsHeight: 0, protectedControls: [] as Rect[], phoneFightsRegions: [] as Rect[],
    fights: { x: window.innerWidth - fightsWidth - 12, y: 92, width: fightsWidth, height: fightsHeight },
  }))

  useLayoutEffect(() => {
    const trigger = legendButton.current
    const controls = trigger?.closest('.replay-header-actions')
    // The stage's parent ref can still be unattached during this child layout effect.
    const host = controls?.closest('.replay-stage')
    if (!host || !trigger || !controls) return
    const sides = host.querySelector('.replay-legend')
    const zoomRow = host.querySelector('.replay-stage-zoom')
    const actions = [...controls.querySelectorAll('.replay-control-trigger, summary')]
    const battleLayout = host.closest('.battle-layout')
    const timeline = battleLayout?.querySelector('.eca-timeline')
    const timelineBar = timeline?.querySelector('.eca-timeline-bar')
    const stageGrip = battleLayout?.querySelector('.battle-stage-grip')
    let frame: number | undefined
    const measure = () => {
      frame = undefined
      const bounds = host.getBoundingClientRect()
      const stageBox = { x: bounds.x, y: bounds.y, width: bounds.width || host.clientWidth, height: bounds.height || host.clientHeight }
      const style = getComputedStyle(host)
      const touch = parseFloat(style.getPropertyValue('--touch-reserve')) || 0
      const mapMin = parseFloat(style.getPropertyValue('--replay-map-min')) || 0
      const barHeight = touch ? touch + (phone ? 2 : 3) : windowHeight
      const minExpandedFightsHeight = barHeight + touch + phoneFightsFrameBorders
      const mapFloor = !phone && stageBox.height > 0 && stageBox.height <= Math.max(shortMapHeight, mapMin + 1)
        ? Math.max(0, Math.min(window.innerHeight - barHeight, Math.ceil(bounds.bottom) + overlayGap)) : 0
      const actionBottom = controls.getBoundingClientRect().bottom + overlayGap
      // Keep the coarse-pointer map free of default windows. Their controls
      // and the longer touch timeline already compete with the pilot labels.
      const timelineBottom = timelineBar?.getBoundingClientRect().bottom ?? 0
      const belowTimeline = !phone && touch && timelineBar ? Math.ceil(timelineBottom) + overlayGap : 0
      const legendTop = belowTimeline || actionBottom
      const topRight = (sides?.getBoundingClientRect().bottom ?? bounds.top) + overlayGap
      const minimized = fightsPreference ?? stageBox.width < compactFightsWidth
      const pilots = !phone && !mapFloor && fightsOpen && hasFights && !savedFights
        ? [...host.querySelectorAll('.replay-marker[data-present] .replay-pilot')].map((pilot) => pilot.getBoundingClientRect()) : []
      const zoom = zoomRow?.getBoundingClientRect()
      const triggerLeft = trigger.getBoundingClientRect().left
      const legendSharesZoomColumn = zoom && !mapFloor && legendTop < zoom.bottom && legendTop + legendHeight > zoom.top
        && triggerLeft < zoom.right && triggerLeft + legendWidth > zoom.left
      const legendLeft = legendSharesZoomColumn ? Math.min(window.innerWidth - legendWidth, Math.ceil(zoom.right) + overlayGap) : triggerLeft
      const fights = belowTimeline
        ? { x: Math.max(0, bounds.right - fightsWidth - 12), y: belowTimeline, width: fightsWidth, height: fightsHeight }
        : placeFightsWindow(stageBox, topRight, legendTop,
          { width: fightsWidth, height: minimized ? barHeight : fightsHeight }, pilots, zoom ? [zoom] : [])
      const timelineControls = [...(timelineBar?.children ?? [])]
      const hint = timeline?.querySelector('.eca-timeline-hint')
      if (hint && !timelineControls.includes(hint)) timelineControls.push(hint)
      const protectedControls = [...actions, ...(zoomRow ? [zoomRow] : []), ...(stageGrip ? [stageGrip] : []), ...timelineControls]
        .map((element) => paddedRect(element.getBoundingClientRect(), 2))
      const phoneFightsRegions = phone ? phoneFightsRegion(stageBox, [
        ...protectedControls, ...Array.from(sides?.children ?? [], (element) => paddedRect(element.getBoundingClientRect(), 2)),
      ], minExpandedFightsHeight, barHeight, touch) : []
      const top = Math.max(0, Math.ceil(bounds.top), Math.ceil(battleLayout?.getBoundingClientRect().top ?? 0), mapFloor)
      const next = { width: window.innerWidth, height: window.innerHeight,
        left: legendLeft, stageWidth: stageBox.width, legendTop, mapFloor, phoneFightsRegions,
        top, barHeight, minExpandedFightsHeight, protectedControls,
        fights: { ...fights, height: fightsHeight } }
      setGeometry((previous) => previous.width === next.width && previous.height === next.height
        && previous.left === next.left && previous.stageWidth === next.stageWidth
        && previous.legendTop === next.legendTop && previous.mapFloor === mapFloor
        && sameRects(previous.phoneFightsRegions, phoneFightsRegions)
        && previous.top === top && previous.barHeight === barHeight && previous.minExpandedFightsHeight === minExpandedFightsHeight
        && sameRects(previous.protectedControls, protectedControls)
        && previous.fights.x === fights.x && previous.fights.y === fights.y && previous.fights.width === fights.width ? previous : next)
    }
    const schedule = () => { frame ??= requestAnimationFrame(measure) }
    onLayoutChange.current = schedule
    if (fightsOpen && hasFights && !savedFights && host.querySelector('.replay-marker[data-present]')) measure()
    schedule()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(host)
    observer?.observe(controls)
    if (zoomRow) observer?.observe(zoomRow)
    if (sides) observer?.observe(sides)
    if (timelineBar) observer?.observe(timelineBar)
    if (timeline) observer?.observe(timeline)
    for (const group of timelineBar?.children ?? []) observer?.observe(group)
    window.addEventListener('resize', schedule)
    window.addEventListener('scroll', schedule, true)
    return () => {
      onLayoutChange.current = null
      if (frame !== undefined) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
      window.removeEventListener('scroll', schedule, true)
    }
  }, [phone, hasFights, fightsOpen, fightsPreference, savedFights, placementTime, onLayoutChange])

  useLayoutEffect(() => {
    const id = keyboardOpen.current
    if (!id || !(phone && id === 'fights' ? phoneFightsOpen : layout.overlays[id].open)) return
    keyboardOpen.current = null
    document.getElementById(`${baseId}-${id}`)?.querySelector<HTMLElement>('.battle-window-titlebar')
      ?.focus({ preventScroll: true })
  }, [baseId, layout, phone, phoneFightsOpen])

  return replayOverlayIds.map((id) => {
    if (id === 'fights' && !closeFights) return null
    const trigger = id === 'legend' ? legendButton : fightsButton
    const state = layout.overlays[id]
    const sizeRequiresCollapse = geometry.mapFloor > 0 && geometry.height - geometry.mapFloor < shortMapHeight
    const collapsed = sizeRequiresCollapse || (state.collapsed ?? (id === 'fights' && geometry.stageWidth < compactFightsWidth))
    const domId = `${baseId}-${id}`
    if (phone && id === 'fights') {
      const title = titles[id]
      const viewport = geometry.phoneFightsRegions[0]
      const open = phoneFightsOpen && Boolean(viewport)
      const rect = { x: Math.max(0, (viewport?.width ?? 0) - fightsWidth), y: 0, width: fightsWidth, height: fightsHeight }
      const minSideTitleHeight = geometry.minExpandedFightsHeight - geometry.barHeight - phoneFightsFrameBorders
        + phoneFightsCompactHeight
      const sideTitle = viewport && viewport.height >= minSideTitleHeight && viewport.height < geometry.minExpandedFightsHeight
        && !phoneFightsCollapsed
      return <div className="replay-overlay-trigger" key={id}>
        <button ref={trigger} type="button" className="replay-control-trigger" data-replay-trigger={id}
          aria-expanded={open} aria-controls={open ? domId : undefined} onClick={(event) => {
            if (event.detail === 0 && !open) keyboardOpen.current = id
            if (!open && layout.overlays.legend.open) dispatch({ type: 'toggle', id: 'legend' })
            setPhoneFightsOpen(!open)
          }}>{title}</button>
        {open && viewport && createPortal(
          <WindowFrame<ReplayOverlayId> id={id} title={title} region={title} kind="section" desk={stage} subtitle={fightTime}
            viewport={viewport} zIndex={2}
            state={{ floating: true, hidden: false, minimized: phoneFightsCollapsed, rect: phoneFightsRect ?? rect }}
            overlay={{ domId, fixedOrigin: viewport, touch: true, barHeight: geometry.barHeight, minWidth: minPhoneFightsWidth,
              setCancel: (cancel) => { if (workspace) workspace.cancelDrag.current = cancel } }}
            dispatch={(action) => {
              if (action.type === 'position') setPhoneFightsRect(action.rect)
              if (action.type === 'minimize') setPhoneFightsCollapsed((previous) => !previous)
              if (action.type === 'dock') {
                setPhoneFightsOpen(false)
                trigger.current?.focus({ preventScroll: true })
              }
            }}>
            {sideTitle && <span className={phoneFightsSideTitle} hidden />}
            {closeFights}
          </WindowFrame>, workspace?.layer ?? document.body)}
      </div>
    }
    const viewport = { x: 0, y: geometry.top, width: geometry.width, height: geometry.height - geometry.top }
    const constrain = (rect: Rect, minimized: boolean, alignWithHeader?: boolean) =>
      placeReplayWindow(rect, viewport, geometry.protectedControls, geometry.barHeight, minimized, alignWithHeader)
    const fine = geometry.barHeight === windowHeight
    const initialLegend = { x: geometry.left, y: geometry.legendTop, width: legendWidth, height: legendHeight }
    function defaultLegend() {
      if (!fine || collapsed) return initialLegend
      const full = constrain(initialLegend, false, true)
      if (full.y === initialLegend.y && full.height === legendHeight) return full
      const compact = constrain({ ...initialLegend, ...compactLegend }, false, true)
      return compact.y === initialLegend.y && compact.height === compactLegend.height ? compact : full
    }
    const preferred = state.rect ?? (id === 'legend' ? defaultLegend() : geometry.fights)

    function onWindowAction(action: ReplayOverlayAction) {
      dispatch(action.type === 'minimize' ? { type: 'collapse', id, collapsed: !collapsed } : action)
      if (action.type === 'dock') trigger.current?.focus({ preventScroll: true })
    }

    return <div className="replay-overlay-trigger" key={id}>
      <button ref={trigger} type="button" className="replay-control-trigger" data-replay-trigger={id}
        aria-expanded={state.open} aria-controls={state.open ? domId : undefined} onClick={(event) => {
          if (event.detail === 0 && !state.open) keyboardOpen.current = id
          if (phone && id === 'legend' && !state.open) setPhoneFightsOpen(false)
          dispatch({ type: 'toggle', id })
        }}>{titles[id]}</button>
      {state.open && createPortal(
        <WindowFrame<ReplayOverlayId> id={id} title={titles[id]} region={titles[id]} kind="section" desk={stage}
          subtitle={id === 'fights' ? fightTime : undefined}
          viewport={geometry} state={{ floating: true, hidden: false, minimized: collapsed, rect: preferred }}
          zIndex={layout.order.indexOf(id) + 1}
          overlay={{ domId, minWidth: id === 'fights' ? 300 : undefined,
            barHeight: geometry.barHeight, constrain,
            setCancel: (cancel) => { if (workspace) workspace.cancelDrag.current = cancel } }}
          dispatch={onWindowAction}>
          {id === 'legend' ? <InteractionKey active={!collapsed} /> : closeFights}
        </WindowFrame>, workspace?.layer ?? document.body)}
    </div>
  })
}
