// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { WindowFrame } from './WindowFrame'
import { windowDragClass } from './layout'

beforeEach(() => vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true))
afterEach(() => vi.unstubAllGlobals())

it('captures drag, disables document selection, snaps and clears drag state on release and cancel', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const desktop = createRef<HTMLDivElement>()
  const dispatch = vi.fn()
  function render() {
    act(() => root.render(<div ref={desktop}><WindowFrame id="feed" title="事件" kind="aside" region="事件流"
      desk={desktop} viewport={{ width: 1280, height: 752 }} zIndex={4} dispatch={dispatch}
      state={{ floating: true, hidden: false, minimized: false, rect: { x: 500, y: 100, width: 350, height: 300 } }}>
      <p>事件窗口内容</p>
    </WindowFrame></div>))
  }
  try {
    render()
    const titleBar = host.querySelector<HTMLElement>('.battle-window-titlebar')!
    const capture = vi.fn()
    Object.defineProperty(titleBar, 'setPointerCapture', { value: capture })
    const pointer = (type: string, x: number, target: Element = titleBar) => act(() => {
      target.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, button: 0, clientX: x, clientY: 110 }))
    })
    const selection = window.getSelection()!
    selection.selectAllChildren(host.querySelector('p')!)
    expect(selection.toString()).toBe('事件窗口内容')
    const heading = titleBar.querySelector('.battle-window-heading')!
    for (const target of [heading.firstElementChild ?? heading, titleBar.querySelector('button')!]) {
      pointer('pointerdown', 520, target)
      expect(capture).not.toHaveBeenCalled()
      expect(document.body.classList.contains(windowDragClass)).toBe(false)
    }
    pointer('pointerdown', 520)
    expect(capture).toHaveBeenCalledWith(1)
    expect(document.body.classList.contains(windowDragClass)).toBe(true)
    expect(selection.toString()).toBe('')
    pointer('pointermove', 1270)
    expect(host.querySelector('[data-dock-guide="right"]')).not.toBeNull()
    pointer('pointerup', 1270)
    expect(dispatch).toHaveBeenCalledWith({ type: 'dock', id: 'feed' })
    expect(document.body.classList.contains(windowDragClass)).toBe(false)
    expect(host.querySelector('[data-dock-guide]')).toBeNull()

    pointer('pointerdown', 520)
    expect(document.body.classList.contains(windowDragClass)).toBe(true)
    pointer('pointercancel', 610)
    expect(document.body.classList.contains(windowDragClass)).toBe(false)
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})

it('resizes from a labeled keyboard grip with the same clamps as the pointer', () => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  const desk = createRef<HTMLDivElement>()
  const dispatch = vi.fn()
  const rect = { x: 100, y: 80, width: 320, height: 144 }
  try {
    act(() => root.render(<div ref={desk}><WindowFrame id="fights" title="此刻交火" kind="section" region="此刻交火"
      desk={desk} viewport={{ width: 428, height: 250 }} zIndex={2} dispatch={dispatch}
      state={{ floating: true, hidden: false, minimized: false, rect }}
      overlay={{ domId: 'fights', minWidth: 300, setCancel: vi.fn() }}>交火</WindowFrame></div>))
    const grip = host.querySelector<HTMLElement>('.battle-window-grip')!
    expect(grip.getAttribute('aria-label')).toBe('调整 此刻交火 大小')
    expect(grip.tabIndex).toBe(0)
    act(() => grip.focus())
    expect(document.activeElement).toBe(grip)
    const key = (key: string, shiftKey = false) => {
      const event = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
      act(() => { grip.dispatchEvent(event) })
      expect(event.defaultPrevented).toBe(true)
    }
    key('ArrowLeft')
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'position', id: 'fights', rect: { ...rect, width: 312 } })
    key('ArrowLeft', true)
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'position', id: 'fights', rect: { ...rect, width: 300 } })
    key('ArrowUp', true)
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'position', id: 'fights', rect: { ...rect, height: 120 } })
    key('ArrowDown', true)
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'position', id: 'fights', rect: { ...rect, height: 170 } })
    key('ArrowRight', true)
    expect(dispatch).toHaveBeenLastCalledWith({ type: 'position', id: 'fights', rect: { ...rect, width: 328 } })
    key('Escape')
    expect(document.activeElement).toBe(host.querySelector('.battle-window-titlebar'))
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
