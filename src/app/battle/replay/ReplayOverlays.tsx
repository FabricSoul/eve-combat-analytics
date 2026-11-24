import { createContext, useContext, useId, useLayoutEffect, useReducer, useRef, useState,
  type Dispatch, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { WindowFrame } from '../../shell/windows/WindowFrame'
import { defaultReplayOverlays, replayOverlayIds, replayOverlayReducer,
  type ReplayOverlayAction, type ReplayOverlayId, type ReplayOverlayLayout } from '../../shell/windows/replay-layout'
import { InteractionKey } from './InteractionKey'
import '../../shell/windows/windows.css'

export const ReplayOverlayWorkspace = createContext<{
  layer: HTMLElement | null
  layout: ReplayOverlayLayout
  dispatch: Dispatch<ReplayOverlayAction>
  cancelDrag: RefObject<(() => boolean) | null>
} | null>(null)

const titles = { legend: '交互图例', fights: '此刻交火' }
const overlayGap = 8
const fightsWidth = 220

export function ReplayOverlays({ stage, closeFights, fightTime }: {
  stage: RefObject<HTMLDivElement | null>
  closeFights?: ReactNode
  fightTime?: ReactNode
}) {
  const workspace = useContext(ReplayOverlayWorkspace)
  const [localLayout, localDispatch] = useReducer(replayOverlayReducer, undefined, defaultReplayOverlays)
  const { layout, dispatch } = workspace ?? { layout: localLayout, dispatch: localDispatch }
  const legendButton = useRef<HTMLButtonElement>(null)
  const fightsButton = useRef<HTMLButtonElement>(null)
  const keyboardOpen = useRef<ReplayOverlayId | null>(null)
  const baseId = useId()
  const anchoredToPage = workspace !== null
  const [geometry, setGeometry] = useState(() => ({
    width: window.innerWidth, height: window.innerHeight, left: 24, right: window.innerWidth - 12,
    legendTop: 120, fightsTop: 92,
  }))

  useLayoutEffect(() => {
    const trigger = legendButton.current
    const controls = trigger?.closest('.replay-header-actions')
    // The stage's parent ref can still be unattached during this child layout effect.
    const host = controls?.closest('.replay-stage')
    if (!host || !trigger || !controls) return
    const sides = host.querySelector('.replay-legend')
    const measure = () => {
      const bounds = host.getBoundingClientRect()
      const next = { width: window.innerWidth, height: window.innerHeight,
        left: trigger.getBoundingClientRect().left, right: bounds.right - 12,
        legendTop: controls.getBoundingClientRect().bottom + overlayGap,
        fightsTop: (sides?.getBoundingClientRect().bottom ?? bounds.top) + overlayGap }
      setGeometry((previous) => previous.width === next.width && previous.height === next.height
        && previous.left === next.left && previous.right === next.right
        && previous.legendTop === next.legendTop && previous.fightsTop === next.fightsTop ? previous : next)
    }
    measure()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure)
    observer?.observe(host)
    observer?.observe(controls)
    if (sides) observer?.observe(sides)
    window.addEventListener('resize', measure)
    if (!anchoredToPage) window.addEventListener('scroll', measure, true)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      if (!anchoredToPage) window.removeEventListener('scroll', measure, true)
    }
  }, [anchoredToPage])

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
    const domId = `${baseId}-${id}`
    const rect = state.rect ?? (id === 'legend'
      ? { x: geometry.left, y: geometry.legendTop, width: 236, height: Math.min(424, geometry.height - geometry.legendTop - overlayGap) }
      : { x: geometry.right - fightsWidth, y: geometry.fightsTop, width: fightsWidth, height: 164 })

    function onWindowAction(action: ReplayOverlayAction) {
      dispatch(action)
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
          viewport={geometry} state={{ floating: true, hidden: false, minimized: state.collapsed, rect }}
          zIndex={layout.order.indexOf(id) + 1}
          overlay={{ domId, setCancel: (cancel) => { if (workspace) workspace.cancelDrag.current = cancel } }}
          dispatch={onWindowAction}>
          {id === 'legend' ? <InteractionKey active={!state.collapsed} /> : closeFights}
        </WindowFrame>, workspace?.layer ?? document.body)}
    </div>
  })
}
