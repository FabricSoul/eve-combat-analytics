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
    const pointer = (type: string, x: number) => act(() => {
      titleBar.dispatchEvent(new PointerEvent(type, { pointerId: 1, bubbles: true, button: 0, clientX: x, clientY: 110 }))
    })
    const selection = window.getSelection()!
    selection.selectAllChildren(host.querySelector('p')!)
    expect(selection.toString()).toBe('事件窗口内容')
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
