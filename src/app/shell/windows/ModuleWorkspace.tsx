import { useEffect, useLayoutEffect, useRef, useState, type Dispatch, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { WindowFrame } from './WindowFrame'
import { windowDragClass, type Viewport, type WindowAction } from './layout'
import { areaNames, clampStage, floatModule, keyboardDrop, moduleIds, moduleTitles, visibleArea, type ModuleAction, type ModuleId, type ModuleLayout } from './modules'

type Move = Extract<ModuleAction, { type: 'move' }>
type Drag = { id: ModuleId; pointer: number; bar: HTMLElement; target: Move | null }

export function ModuleControls({ layout, dispatch }: { layout: ModuleLayout; dispatch: Dispatch<ModuleAction> }) {
  return <details className="battle-module-controls">
    <summary aria-label="模块" title="模块">▦</summary>
    <div className="battle-module-menu" role="group" aria-label="显示模块">
      {moduleIds.map((id) => <label key={id}>
        <input type="checkbox" checked={!layout.modules[id].hidden} onChange={() => dispatch({ type: 'toggle', id })} />
        {moduleTitles[id]}
      </label>)}
      <button type="button" onClick={() => dispatch({ type: 'reset' })}>恢复默认布局</button>
    </div>
  </details>
}

export function StageGrip({ height, viewportHeight, dispatch }: {
  height: number; viewportHeight: number; dispatch: Dispatch<ModuleAction>
}) {
  const pointer = useRef<{ id: number; start: number; height: number } | null>(null)
  function release(event: PointerEvent) {
    if (pointer.current?.id === event.pointerId) pointer.current = null
  }
  return <div className="battle-stage-grip" role="separator" tabIndex={0} title="调整舞台高度，双击恢复默认"
    aria-label="调整舞台高度" aria-orientation="horizontal" aria-valuemin={300}
    aria-valuemax={Math.max(300, Math.floor(viewportHeight * 0.75))} aria-valuenow={height}
    onDoubleClick={() => dispatch({ type: 'stage', height: null })}
    onKeyDown={(event) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown' && event.key !== 'Home') return
      event.preventDefault()
      dispatch({ type: 'stage', height: event.key === 'Home' ? null : clampStage(height + (event.key === 'ArrowUp' ? -16 : 16), viewportHeight) })
    }}
    onPointerDown={(event) => {
      if (event.button !== 0) return
      event.currentTarget.setPointerCapture(event.pointerId)
      pointer.current = { id: event.pointerId, start: event.clientY, height }
    }}
    onPointerMove={(event) => {
      const drag = pointer.current
      if (drag?.id === event.pointerId) dispatch({ type: 'stage', height: clampStage(drag.height + event.clientY - drag.start, viewportHeight) })
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
      if (drag.current) document.body.classList.remove(windowDragClass)
      dragCancel.current = null
    }
  }, [dragCancel])

  function finish(commit: boolean, pointer?: number) {
    const current = drag.current
    if (!current || (pointer !== undefined && current.pointer !== pointer)) return false
    drag.current = null
    document.body.classList.remove(windowDragClass)
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
    event.preventDefault()
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture(event.pointerId)
    document.getSelection()?.removeAllRanges()
    document.body.classList.add(windowDragClass)
    drag.current = { id, pointer: event.pointerId, bar: event.currentTarget, target: null }
    setPreview({ source: id, to: null })
  }

  function targetAt(id: ModuleId, event: PointerEvent): Move | null {
    const deskBounds = desk.current?.getBoundingClientRect()
    if (!deskBounds || event.clientY < deskBounds.top || event.clientY > deskBounds.bottom) return null
    const scroll = desk.current?.querySelector('.battle-module-scroll')
    if (event.clientY > deskBounds.bottom - 32) scroll?.scrollBy(0, 18)
    if (event.clientY < deskBounds.top + 32) scroll?.scrollBy(0, -18)
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
