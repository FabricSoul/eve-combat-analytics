import { createContext, useContext, useId, useLayoutEffect, useReducer, useRef, useState,
  type Dispatch, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { WindowFrame } from '../../shell/windows/WindowFrame'
import { windowHeight } from '../../shell/windows/layout'
import { defaultReplayOverlays, replayOverlayIds, replayOverlayReducer,
  type ReplayOverlayAction, type ReplayOverlayId, type ReplayOverlayLayout } from '../../shell/windows/replay-layout'
import { InteractionKey } from './InteractionKey'
import { placeFightsWindow, placeShortMapWindow, shortMapHeight } from './placement'
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
const fightsWidth = 336
const fightsHeight = 164
const compactFightsWidth = 1200

export function ReplayOverlays({ stage, closeFights, fightTime, placementTime, onLayoutChange }: {
  stage: RefObject<HTMLDivElement | null>
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
  const anchoredToPage = workspace !== null
  const hasFights = Boolean(closeFights)
  const { open: fightsOpen, collapsed: fightsPreference, rect: savedFights } = layout.overlays.fights
  const [geometry, setGeometry] = useState(() => ({
    width: window.innerWidth, height: window.innerHeight, stageWidth: window.innerWidth, left: 24, legendTop: 120, mapFloor: 0,
    fights: { x: window.innerWidth - fightsWidth - 12, y: 92, width: fightsWidth, height: fightsHeight },
  }))

  useLayoutEffect(() => {
    const trigger = legendButton.current
    const controls = trigger?.closest('.replay-header-actions')
    // The stage's parent ref can still be unattached during this child layout effect.
    const host = controls?.closest('.replay-stage')
    if (!host || !trigger || !controls) return
    const sides = host.querySelector('.replay-legend')
    let frame: number | undefined
    const measure = () => {
      frame = undefined
      const bounds = host.getBoundingClientRect()
      const stageBox = { x: bounds.x, y: bounds.y, width: bounds.width || host.clientWidth, height: bounds.height || host.clientHeight }
      const mapFloor = stageBox.height > 0 && stageBox.height < shortMapHeight
        ? Math.max(0, Math.min(window.innerHeight - windowHeight, Math.ceil(stageBox.y + stageBox.height) + overlayGap)) : 0
      const legendTop = controls.getBoundingClientRect().bottom + overlayGap
      const topRight = (sides?.getBoundingClientRect().bottom ?? bounds.top) + overlayGap
      const minimized = fightsPreference ?? stageBox.width < compactFightsWidth
      const pilots = !mapFloor && fightsOpen && hasFights && !savedFights
        ? [...host.querySelectorAll('.replay-marker[data-present] .replay-pilot')].map((pilot) => pilot.getBoundingClientRect()) : []
      const fights = placeFightsWindow(stageBox, topRight, legendTop,
        { width: fightsWidth, height: minimized ? windowHeight : fightsHeight }, pilots)
      const next = { width: window.innerWidth, height: window.innerHeight,
        left: trigger.getBoundingClientRect().left, stageWidth: stageBox.width, legendTop, mapFloor,
        fights: { ...fights, height: fightsHeight } }
      setGeometry((previous) => previous.width === next.width && previous.height === next.height
        && previous.left === next.left && previous.stageWidth === next.stageWidth && previous.legendTop === next.legendTop && previous.mapFloor === mapFloor
        && previous.fights.x === fights.x && previous.fights.y === fights.y && previous.fights.width === fights.width ? previous : next)
    }
    const schedule = () => { frame ??= requestAnimationFrame(measure) }
    onLayoutChange.current = schedule
    if (fightsOpen && hasFights && !savedFights && host.querySelector('.replay-marker[data-present]')) measure()
    schedule()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule)
    observer?.observe(host)
    observer?.observe(controls)
    if (sides) observer?.observe(sides)
    window.addEventListener('resize', schedule)
    if (!anchoredToPage) window.addEventListener('scroll', schedule, true)
    return () => {
      onLayoutChange.current = null
      if (frame !== undefined) cancelAnimationFrame(frame)
      observer?.disconnect()
      window.removeEventListener('resize', schedule)
      if (!anchoredToPage) window.removeEventListener('scroll', schedule, true)
    }
  }, [anchoredToPage, hasFights, fightsOpen, fightsPreference, savedFights, placementTime, onLayoutChange])

  useLayoutEffect(() => {
    const id = keyboardOpen.current
    if (!id || !layout.overlays[id].open) return
    keyboardOpen.current = null
    document.getElementById(`${baseId}-${id}`)?.querySelector<HTMLElement>('.battle-window-titlebar')
      ?.focus({ preventScroll: true })
  }, [baseId, layout])

  return replayOverlayIds.map((id) => {
    if (id === 'fights' && !closeFights) return null
    const trigger = id === 'legend' ? legendButton : fightsButton
    const state = layout.overlays[id]
    const sizeRequiresCollapse = geometry.mapFloor > 0 && geometry.height - geometry.mapFloor < shortMapHeight
    const collapsed = sizeRequiresCollapse || (state.collapsed ?? (id === 'fights' && geometry.stageWidth < compactFightsWidth))
    const domId = `${baseId}-${id}`
    const preferred = state.rect ?? (id === 'legend'
      ? { x: geometry.left, y: geometry.legendTop, width: 236, height: Math.min(424, geometry.height - geometry.legendTop - overlayGap) }
      : geometry.fights)
    const clampToMap = (rect: typeof preferred) => geometry.mapFloor
      ? placeShortMapWindow(rect, geometry.mapFloor, geometry.height, collapsed ? windowHeight : 0) : rect

    function onWindowAction(action: ReplayOverlayAction) {
      if (action.type === 'position') dispatch({ ...action, rect: clampToMap(action.rect) })
      else dispatch(action.type === 'minimize' ? { type: 'collapse', id, collapsed: !collapsed } : action)
      if (action.type === 'dock') trigger.current?.focus({ preventScroll: true })
    }

    return <div className="replay-overlay-trigger" key={id}>
      <button ref={trigger} type="button" className="replay-control-trigger" data-replay-trigger={id}
        aria-expanded={state.open} aria-controls={state.open ? domId : undefined} onClick={(event) => {
          if (event.detail === 0 && !state.open) keyboardOpen.current = id
          dispatch({ type: 'toggle', id })
        }}>{titles[id]}</button>
      {state.open && createPortal(
        <WindowFrame<ReplayOverlayId> id={id} title={titles[id]} region={titles[id]} kind="section" desk={stage}
          subtitle={id === 'fights' ? fightTime : undefined}
          viewport={geometry} state={{ floating: true, hidden: false, minimized: collapsed, rect: clampToMap(preferred) }}
          zIndex={layout.order.indexOf(id) + 1}
          overlay={{ domId, minWidth: id === 'fights' ? 300 : undefined,
            setCancel: (cancel) => { if (workspace) workspace.cancelDrag.current = cancel } }}
          dispatch={onWindowAction}>
          {id === 'legend' ? <InteractionKey active={!collapsed} /> : closeFights}
        </WindowFrame>, workspace?.layer ?? document.body)}
    </div>
  })
}
