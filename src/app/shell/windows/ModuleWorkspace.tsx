import { useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { Button } from '../../ui/Button'
import { WorkspaceIcon } from '../../ui/icons/WorkspaceIcon'
import { WindowFrame } from './WindowFrame'
import { windowDragClass, type Viewport, type WindowAction } from './layout'
import { areaNames, clampStage, floatModule, keyboardDrop, moduleIds, moduleTitles, visibleArea, type ModuleAction, type ModuleId, type ModuleLayout } from './modules'

type Move = Extract<ModuleAction, { type: 'move' }>
type Drag = {
  id: ModuleId; pointer: number; bar: HTMLElement; target: Move | null
  ghost: HTMLElement; offsetX: number; offsetY: number
}

export function ModuleControls({ layout, dispatch, columns }: {
  layout: ModuleLayout; dispatch: Dispatch<ModuleAction>; columns: number
}) {
  const descriptionId = useId()
  const disclosure = useRef<HTMLDetailsElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const [restored, setRestored] = useState(false)
  useEffect(() => () => clearTimeout(timer.current), [])

  function restore() {
    dispatch({ type: 'reset' })
    if (disclosure.current) {
      disclosure.current.open = false
      disclosure.current.querySelector('summary')?.focus({ preventScroll: true })
    }
    setRestored(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setRestored(false), 2400)
  }

  return <div className="battle-layout-tools">
    <details ref={disclosure} className="battle-module-controls">
      <summary title="布局"><WorkspaceIcon name="layout" />布局</summary>
      <div className="battle-module-menu" role="group" aria-label="显示模块">
        <p className="battle-module-menu-hint">拖动模块标题栏的 ⠿ 调整位置</p>
        {areaNames.slice(0, columns).map((area, column) => <fieldset key={area}>
          <legend>第 {column + 1} 列</legend>
          {visibleArea(layout, column, columns).map((id) => {
            const { hidden, floating, collapsed } = layout.modules[id]
            const status = [floating && '浮窗', collapsed && '收起'].filter(Boolean).join(' · ')
            const badge = `${descriptionId}-${id}`
            return <label key={id}>
              <input type="checkbox" checked={!hidden} aria-label={moduleTitles[id]}
                aria-describedby={status ? badge : undefined} onChange={() => dispatch({ type: 'toggle', id })} />
              <span>{moduleTitles[id]}</span>{status && <small id={badge}>{status}</small>}
            </label>
          })}
        </fieldset>)}
        <Button variant="ghost" onClick={restore}>恢复默认布局</Button>
      </div>
    </details>
    {restored && <div className="battle-layout-confirmation" role="status">已恢复默认布局</div>}
  </div>
}

export function StageGrip({ height, limits, dispatch }: {
  height: number; limits: { min: number; max: number; fixedHeight: number }; dispatch: Dispatch<ModuleAction>
}) {
  const pointer = useRef<{ id: number; start: number; height: number } | null>(null)
  const fixed = limits.min === limits.max
  function release(event: PointerEvent) {
    if (pointer.current?.id === event.pointerId) pointer.current = null
  }
  return <div className="battle-stage-grip" role="separator" tabIndex={0} aria-disabled={fixed || undefined}
    title={fixed ? '屏幕太矮，舞台高度固定' : '拖动调整高度，双击恢复'}
    style={fixed ? { cursor: 'default', touchAction: 'pan-y' } : undefined}
    aria-label="调整舞台高度" aria-orientation="horizontal" aria-valuemin={limits.min + limits.fixedHeight}
    aria-valuemax={limits.max + limits.fixedHeight} aria-valuenow={height + limits.fixedHeight}
    onDoubleClick={() => {
      if (!fixed) dispatch({ type: 'stage', height: null })
    }}
    onKeyDown={(event) => {
      if (fixed || (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home')) return
      event.preventDefault()
      dispatch({ type: 'stage', height: event.key === 'Home' ? null : clampStage(height + (event.key === 'ArrowUp' ? -16 : 16), limits) })
    }}
    onPointerDown={(event) => {
      if (fixed || event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      pointer.current = { id: event.pointerId, start: event.clientY, height }
    }}
    onPointerMove={(event) => {
      const drag = pointer.current
      if (!fixed && drag?.id === event.pointerId) dispatch({ type: 'stage', height: clampStage(drag.height + event.clientY - drag.start, limits) })
    }} onPointerUp={release} onPointerCancel={release} onLostPointerCapture={release} />
}

interface ModuleWorkspaceProps {
  desk: RefObject<HTMLDivElement | null>
  viewport: Viewport
  layout: ModuleLayout
  dispatch: Dispatch<ModuleAction>
  columns: number
  dragCancel: RefObject<(() => boolean) | null>
  subtitles: Record<ModuleId, ReactNode>
  content(id: ModuleId): ReactNode
  tools(id: ModuleId): ReactNode
}

export function ModuleWorkspace({ desk, viewport, layout, dispatch, columns, dragCancel, subtitles, content, tools }: ModuleWorkspaceProps) {
  const areas = useRef<HTMLDivElement>(null)
  const [hosts] = useState(() => Object.fromEntries(moduleIds.map((id) => {
    const host = document.createElement('div')
    host.className = 'battle-module-slot'
    return [id, host]
  })) as Record<ModuleId, HTMLDivElement>)
  const drag = useRef<Drag | null>(null)
  const floatCancel = useRef<(() => boolean) | null>(null)
  const floatTarget = useRef<Move | null>(null)
  const [preview, setPreview] = useState<{ source: ModuleId; to: Move | null } | null>(null)
  const focusNext = useRef<ModuleId | null>(null)

  useLayoutEffect(() => {
    if (focusNext.current) {
      areas.current?.querySelector<HTMLElement>(`[data-module="${focusNext.current}"] .battle-window-titlebar`)?.focus()
      focusNext.current = null
    }
  }, [layout])

  useEffect(() => {
    dragCancel.current = () => finish(false) || (floatCancel.current?.() ?? false)
    return () => {
      if (drag.current) {
        drag.current.ghost.remove()
        document.body.classList.remove(windowDragClass)
      }
      dragCancel.current = null
    }
  }, [dragCancel])

  function finish(commit: boolean, pointer?: number) {
    const current = drag.current
    if (!current || (pointer !== undefined && current.pointer !== pointer)) return false
    drag.current = null
    document.body.classList.remove(windowDragClass)
    current.ghost.remove()
    if (current.bar.hasPointerCapture(current.pointer)) current.bar.releasePointerCapture(current.pointer)
    setPreview(null)
    if (commit && current.target) {
      focusNext.current = current.id
      dispatch(current.target)
    }
    return true
  }

  function start(id: ModuleId, event: PointerEvent<HTMLElement>) {
    if (event.button !== 0 || (event.target as Element).closest('button, input, summary, a, .battle-window-heading') || drag.current) return
    const frame = event.currentTarget.closest<HTMLElement>('[data-module]')
    if (!frame) return
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    document.getSelection()?.removeAllRanges()
    document.body.classList.add(windowDragClass)
    const { x, y, width, height } = frame.getBoundingClientRect()
    const ghost = frame.cloneNode(true) as HTMLElement
    ghost.removeAttribute('data-module')
    ghost.removeAttribute('data-window')
    ghost.setAttribute('data-module-ghost', '')
    ghost.setAttribute('aria-hidden', 'true')
    ghost.inert = true
    for (const element of ghost.querySelectorAll('[id]')) element.removeAttribute('id')
    ghost.style.width = `${width}px`
    ghost.style.height = `${height}px`
    ghost.style.transform = `translate3d(${x}px, ${y}px, 0)`
    document.body.appendChild(ghost)
    drag.current = { id, pointer: event.pointerId, bar: event.currentTarget, target: null, ghost,
      offsetX: event.clientX - x, offsetY: event.clientY - y }
    setPreview({ source: id, to: null })
  }

  function targetAt(id: ModuleId, event: PointerEvent): Move | null {
    const scroll = desk.current?.querySelector('.battle-module-scroll')
    const bounds = scroll?.getBoundingClientRect()
    if (!scroll || !bounds || event.clientY < bounds.top || event.clientY > bounds.bottom) return null
    if (event.clientY > bounds.bottom - 32) scroll.scrollBy(0, 18)
    if (event.clientY < bounds.top + 32) scroll.scrollBy(0, -18)
    const { clientX: x, clientY: y } = event
    const targetArea = [...(areas.current?.querySelectorAll<HTMLElement>('[data-module-area]') ?? [])].find((node) => {
      const rect = node.getBoundingClientRect()
      return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom
    })
    if (!targetArea) return null
    const displayed = Number(targetArea.dataset.moduleArea)
    const peers = [...targetArea.querySelectorAll<HTMLElement>('[data-module][data-floating="false"]')]
      .filter((node) => node.dataset.module !== id)
    const next = peers.find((node) => {
      const rect = node.getBoundingClientRect()
      return y < rect.top + rect.height / 2
    })
    const nearby = (next ?? peers.at(-1))?.dataset.module as ModuleId | undefined
    const area = nearby ? layout.areas.findIndex((items) => items.includes(nearby)) : displayed
    const group = layout.areas[area]!.filter((candidate) => candidate !== id)
    return { type: 'move', id, area, index: nearby ? group.indexOf(nearby) + (next ? 0 : 1) : 0 }
  }

  function move(event: PointerEvent<HTMLDivElement>) {
    const current = drag.current
    if (!current || current.pointer !== event.pointerId) return
    current.ghost.style.transform = `translate3d(${event.clientX - current.offsetX}px, ${event.clientY - current.offsetY}px, 0)`
    const to = targetAt(current.id, event)
    if (to?.area === current.target?.area && to?.index === current.target?.index) return
    current.target = to
    setPreview({ source: current.id, to })
  }

  function moveFloating(id: ModuleId, event: PointerEvent<HTMLElement>) {
    const to = targetAt(id, event)
    if (to?.area === floatTarget.current?.area && to?.index === floatTarget.current?.index) return
    floatTarget.current = to
    setPreview(to ? { source: id, to } : null)
  }

  function finishFloating(commit: boolean) {
    const target = floatTarget.current
    floatTarget.current = null
    setPreview(null)
    if (!commit || !target) return false
    focusNext.current = target.id
    dispatch(target)
    dispatch({ type: 'dock', id: target.id })
    return true
  }

  function useArrow(id: ModuleId, event: KeyboardEvent<HTMLElement>) {
    if (!event.altKey || event.currentTarget !== event.target) return
    const action = keyboardDrop(layout, id, event.key, columns)
    if (!action) return
    event.preventDefault()
    focusNext.current = id
    dispatch(action)
  }

  function translate(id: ModuleId, event: WindowAction) {
    if (event.type === 'pop') dispatch({ type: 'float', id, rect: layout.modules[id].rect ?? floatModule(id, viewport) })
    else if (event.type === 'position') dispatch({ type: 'position', id, rect: event.rect })
    else if (event.type === 'minimize') dispatch({ type: 'collapse', id })
    else if (event.type === 'dock' || event.type === 'focus') dispatch({ type: event.type, id })
  }

  function frame(id: ModuleId) {
    const state = layout.modules[id]
    if (state.hidden) return null
    return <WindowFrame key={id} id={id === 'lanes' ? 'timeline' : id} kind="section" title={moduleTitles[id]}
      region={moduleTitles[id]} desk={desk} viewport={viewport} state={{ ...state, minimized: state.collapsed }}
      zIndex={4 + layout.order.indexOf(id)} dispatch={(event) => translate(id, event)}
      subtitle={subtitles[id]} module={{ id, dragging: preview?.source === id, tools: tools(id),
        onPointerDown: (event) => start(id, event), onKeyDown: (event) => useArrow(id, event),
        onFloatMove: (event) => moveFloating(id, event), onFloatEnd: finishFloating,
        setFloatCancel: (cancel) => { floatCancel.current = cancel },
      }}>
      {content(id)}
    </WindowFrame>
  }

  return <div ref={areas} className="battle-module-areas" data-columns={columns}
    onPointerMove={move} onPointerUp={(e) => finish(true, e.pointerId)}
    onPointerCancel={(e) => finish(false, e.pointerId)} onLostPointerCapture={(e) => finish(false, e.pointerId)}>
    {areaNames.slice(0, columns).map((name, column) => {
      const list = visibleArea(layout, column, columns)
      const to = preview?.to
      const matching = to && Math.min(to.area, columns - 1) === column
      const targetList = matching ? layout.areas[to.area]!.filter((id) => id !== preview?.source) : []
      const before = matching ? targetList.slice(to.index).find((id) => !layout.modules[id].floating && !layout.modules[id].hidden) : undefined
      const placeholder = <div key="drop" className="battle-module-drop" data-module-drop="" aria-hidden="true" />
      return <div key={name} className="battle-module-area" data-module-area={column} role="group" aria-label={`模块区 ${name.toUpperCase()}`}>
        {list.filter((id) => !layout.modules[id].hidden).flatMap((id) => {
          // Moving a portal host keeps the module’s table filters and scroll position intact.
          const slot = <div key={id} className="battle-module-slot" ref={(element) => {
            if (element && hosts[id].parentElement !== element) element.appendChild(hosts[id])
          }} />
          return id === before ? [placeholder, slot] : [slot]
        })}
        {matching && !before && placeholder}
      </div>
    })}
    {moduleIds.filter((id) => !layout.modules[id].hidden).map((id) => createPortal(frame(id), hosts[id], id))}
  </div>
}
