import { WorkspaceAction, WorkspaceIcon } from '../../ui/icons/WorkspaceIcon'
import {
  useEffect, useId, useRef, useState, type Dispatch, type KeyboardEvent,
  type PointerEvent, type ReactNode, type RefObject,
} from 'react'
import { clampWindow, dockTarget, windowDragClass, windowHeight, type DockEdge, type Viewport,
  type WindowAction, type WindowId, type WindowRect, type WindowState } from './layout'

interface WindowFrameProps<Id extends string> {
  id: Id
  title: string
  subtitle?: ReactNode
  kind: 'aside' | 'section'
  region: string
  desk: RefObject<HTMLDivElement | null>
  viewport: Viewport
  zIndex: number
  dispatch: Dispatch<WindowAction<Id>>
  state: WindowState
  children: ReactNode
  overlay?: { domId: string; minWidth?: number; setCancel: (cancel: (() => boolean) | null) => void }
  module?: {
    id: string
    tools?: ReactNode
    dragging: boolean
    onPointerDown: (event: PointerEvent<HTMLElement>) => void
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => void
    onFloatMove: (event: PointerEvent<HTMLElement>) => void
    onFloatEnd: (commit: boolean) => boolean
    setFloatCancel: (cancel: (() => boolean) | null) => void
  }
}

interface Gesture {
  pointer: number
  element: HTMLElement
  x: number
  y: number
  start: WindowRect
  rect: WindowRect
  mode: 'move' | 'resize'
  target: DockEdge | null
}

const movement: Record<string, readonly [number, number]> = {
  ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1],
}

export function WindowFrame<Id extends string = WindowId>({ id, title, subtitle, kind: Surface, region, desk, viewport, zIndex, dispatch, state, children, module, overlay }: WindowFrameProps<Id>) {
  const body = useId()
  const titleBar = useRef<HTMLDivElement>(null)
  const gesture = useRef<Gesture | null>(null)
  const [preview, setPreview] = useState<{ rect: WindowRect; target: DockEdge | null } | null>(null)
  const stored = state.rect && clampWindow(state.rect, viewport, state.minimized, overlay?.minWidth)
  const rect = preview?.rect ?? stored
  const { floating, minimized } = state

  useEffect(() => () => {
    if (gesture.current) {
      document.body.classList.remove(windowDragClass)
      module?.setFloatCancel(null)
      overlay?.setCancel(null)
    }
  }, [])

  function raise() {
    if (floating) dispatch({ type: 'focus', id })
  }

  function start(event: PointerEvent<HTMLElement>, mode: Gesture['mode']) {
    if (!floating || !rect || event.button !== 0 || gesture.current || document.body.classList.contains(windowDragClass)) return
    if (mode === 'move' && (event.target as Element).closest('button, input, summary, a, .battle-window-heading > span')) return
    event.preventDefault()
    if (mode === 'move') event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    document.getSelection()?.removeAllRanges()
    document.body.classList.add(windowDragClass)
    gesture.current = {
      pointer: event.pointerId, element: event.currentTarget, x: event.clientX, y: event.clientY, start: rect,
      rect, mode, target: null,
    }
    module?.setFloatCancel(cancel)
    overlay?.setCancel(cancel)
  }

  function resize(start: WindowRect, dx: number, dy: number) {
    return clampWindow({ ...start,
      width: Math.min(viewport.width - start.x, start.width + dx),
      height: Math.min(viewport.height - start.y, start.height + dy),
    }, viewport, false, overlay?.minWidth)
  }

  function move(event: PointerEvent<HTMLElement>) {
    const active = gesture.current
    const bounds = desk.current?.getBoundingClientRect()
    if (!active || active.pointer !== event.pointerId || !bounds) return
    const dx = event.clientX - active.x
    const dy = event.clientY - active.y
    const startRect = active.start
    if (active.mode === 'resize') {
      active.rect = resize(startRect, dx, dy)
    } else {
      active.rect = clampWindow({ ...startRect, x: startRect.x + dx, y: startRect.y + dy }, viewport, minimized, overlay?.minWidth)
      if (module) module.onFloatMove(event)
      else if (!overlay) active.target = dockTarget(id, { x: event.clientX - bounds.left, y: event.clientY - bounds.top }, viewport)
    }
    setPreview({ rect: active.rect, target: active.target })
  }

  function resetGesture() {
    gesture.current = null
    document.body.classList.remove(windowDragClass)
    setPreview(null)
    module?.setFloatCancel(null)
    overlay?.setCancel(null)
  }

  function cancel() {
    const active = gesture.current
    if (!active) return false
    resetGesture()
    if (active.element.hasPointerCapture(active.pointer)) active.element.releasePointerCapture(active.pointer)
    if (active.mode === 'move') module?.onFloatEnd(false)
    return true
  }

  function end(event: PointerEvent<HTMLElement>) {
    const active = gesture.current
    if (!active || active.pointer !== event.pointerId) return
    const commit = event.type === 'pointerup'
    resetGesture()
    if (active.mode === 'move' && module?.onFloatEnd(commit)) return
    if (!commit) return
    if (active.target) dispatch({ type: 'dock', id })
    else dispatch({ type: 'position', id, rect: active.rect })
  }

  function moveByKey(event: KeyboardEvent<HTMLElement>) {
    if (module && event.altKey) return module.onKeyDown(event)
    const delta = movement[event.key]
    if (!floating || !stored || !delta || event.currentTarget !== event.target) return
    event.preventDefault()
    const step = event.shiftKey ? 32 : 8
    dispatch({ type: 'position', id, rect: clampWindow({
      ...stored, x: stored.x + delta[0] * step, y: stored.y + delta[1] * step,
    }, viewport, minimized, overlay?.minWidth) })
  }

  function resizeByKey(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      titleBar.current?.focus({ preventScroll: true })
      return
    }
    const delta = movement[event.key]
    if (!stored || !delta) return
    event.preventDefault()
    const step = event.shiftKey ? 32 : 8
    dispatch({ type: 'position', id, rect: resize(stored, delta[0] * step, delta[1] * step) })
  }

  const handlers = { onPointerMove: move, onPointerUp: end, onPointerCancel: end, onLostPointerCapture: end }
  const action = overlay ? '关闭' : floating ? '停靠' : '弹出'
  const size = minimized ? '还原' : module || overlay ? '收起' : '最小化'
  const top = module ? desk.current?.getBoundingClientRect().top ?? 48 : 0
  const close = <button type="button" aria-label={`${action} ${title}`} title={action}
    data-window-close={overlay ? '' : undefined}
    onClick={() => floating ? dispatch({ type: 'dock', id }) : dispatch({ type: 'pop', id, viewport })}>
    <WorkspaceAction icon={floating ? 'close' : 'popout'}>{action}</WorkspaceAction>
  </button>
  return (
    <>
      <Surface data-module={module?.id} data-dragging={module?.dragging || undefined} className={`battle-window ${overlay ? 'battle-replay-overlay' : module ? 'battle-module' : id === 'feed' ? 'battle-feed' : id === 'timeline' ? 'battle-timeline' : 'battle-panel'}`}
        id={overlay?.domId} aria-label={region} data-window={module?.id ?? id} data-floating={floating} data-minimized={minimized}
        style={floating && rect ? { left: rect.x, top: top + rect.y, width: rect.width, height: minimized ? Math.min(windowHeight, viewport.height) : rect.height, zIndex } : undefined}
        onPointerDown={raise} onFocusCapture={raise}>
        <div ref={titleBar} className="battle-window-titlebar" tabIndex={floating || module ? 0 : undefined} role="group"
          aria-label={`${title} 标题栏`} aria-keyshortcuts={module ? 'Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown' : floating ? 'ArrowLeft ArrowRight ArrowUp ArrowDown' : undefined}
          onPointerDown={(event) => !floating && module ? module.onPointerDown(event) : start(event, 'move')} onKeyDown={moveByKey} {...handlers}>
          {(module || overlay) && <span className="battle-module-handle" aria-hidden="true" title={overlay ? '拖动移动窗口' : '拖动移动模块'}><WorkspaceIcon name="grip" /></span>}
          <span className="battle-window-heading">
            <span style={{ cursor: 'default' }}>{title}</span>
            {subtitle && <span className="battle-window-subtitle" style={{ cursor: 'default' }}>{subtitle}</span>}
          </span>
          {module && <span className="battle-module-title-spacer" aria-hidden="true" />}
          {!minimized && module?.tools}
          {!overlay && close}
          <button type="button" aria-label={`${size} ${title}`} title={size} aria-controls={body} aria-expanded={!minimized}
            onClick={() => dispatch({ type: 'minimize', id })}><WorkspaceAction icon={minimized ? 'add' : 'collapse'}>{size}</WorkspaceAction></button>
          {overlay && close}
        </div>
        <div id={body} className={`battle-window-body${!module && id === 'feed' ? ' battle-feed-content' : ''}`} hidden={minimized}>
          {children}
        </div>
        {floating && !minimized && <div className="battle-window-grip" role="group" tabIndex={0}
          aria-label={`调整 ${title} 大小`} aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Escape"
          title="方向键调整大小，Shift 加大步长" onKeyDown={resizeByKey}
          onPointerDown={(event) => start(event, 'resize')} {...handlers} />}
      </Surface>
      {preview?.target && <div className="battle-window-guide" data-dock-guide={preview.target} aria-hidden="true" />}
    </>
  )
}
