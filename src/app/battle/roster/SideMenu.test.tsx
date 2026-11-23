// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../../api/client'
import { Roster } from '../Roster'
import { mountApp } from './testing'

let mounted: ReturnType<typeof mountApp>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(api, 'putSide').mockResolvedValue({ subject: 'char:2', side: 1, source: 'manual', setAt: 1 })
})
afterEach(() => { mounted?.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const more = (name: string) => [...mounted.container.querySelectorAll<HTMLElement>('.roster-row')]
  .find((r) => r.textContent?.includes(name))!.querySelector<HTMLButtonElement>('.roster-more')!
const menu = () => document.querySelector<HTMLElement>('[role="menu"]')
const items = () => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
const key = (el: Element | null, name: string) => act(() => { el?.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true })) })

describe('SideMenu keyboard and placement', () => {
  it('moves focus into the menu, steps with the arrow keys and Home/End', () => {
    mounted = mountApp(createElement(Roster))
    more('Pilot2').focus()
    act(() => more('Pilot2').click())
    expect(document.activeElement).toBe(items()[0])
    key(document.activeElement, 'ArrowDown')
    expect(document.activeElement).toBe(items()[1])
    key(document.activeElement, 'ArrowUp')
    key(document.activeElement, 'ArrowUp')
    expect(document.activeElement).toBe(items().at(-1))
    key(document.activeElement, 'Home')
    expect(document.activeElement).toBe(items()[0])
    key(document.activeElement, 'End')
    expect(document.activeElement).toBe(items().at(-1))
  })

  it('returns focus to the ⋯ button that opened it on Escape', () => {
    mounted = mountApp(createElement(Roster))
    more('Pilot2').focus()
    act(() => more('Pilot2').click())
    key(document.activeElement, 'Escape')
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(more('Pilot2'))
  })

  it('returns focus after choosing an item, and for a right-click menu to the row\'s button', async () => {
    mounted = mountApp(createElement(Roster))
    more('Pilot2').focus()
    act(() => more('Pilot2').click())
    await act(async () => items()[0]!.click())
    expect(menu()).toBeNull()
    expect(document.activeElement).toBe(more('Pilot2'))

    const row = more('Pilot1').closest('.roster-row')!
    act(() => { row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 5, clientY: 5 })) })
    key(document.activeElement, 'Escape')
    expect(document.activeElement).toBe(row.querySelector('.roster-main'))
  })

  describe('placement', () => {
    function measure(natural: number, viewport: number) {
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: viewport })
      vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(natural)
    }
    const rect = (top: number, bottom: number) =>
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
        return this.classList.contains('side-menu')
          ? { top: 0, bottom: 0, left: 0, right: 0, width: 232, height: 0, x: 0, y: 0, toJSON() {} }
          : { top, bottom, left: 10, right: 100, width: 90, height: bottom - top, x: 10, y: top, toJSON() {} }
      })

    it('caps its height to the viewport and scrolls when it has more actions than fit', () => {
      measure(900, 600)
      rect(100, 132)
      mounted = mountApp(createElement(Roster))
      act(() => more('Pilot2').click())
      expect(menu()!.style.maxHeight).toBe('584px')
      expect(menu()!.style.overflowY).toBe('auto')
      expect(menu()!.style.top).toBe('8px')
    })

    it('opens above the row when there is more room there than below', () => {
      measure(200, 600)
      rect(520, 552)
      mounted = mountApp(createElement(Roster))
      act(() => more('Pilot2').click())
      expect(parseInt(menu()!.style.top, 10)).toBe(520 - 200)
    })

    it('opens below the row when it fits', () => {
      measure(200, 600)
      rect(100, 132)
      mounted = mountApp(createElement(Roster))
      act(() => more('Pilot2').click())
      expect(parseInt(menu()!.style.top, 10)).toBe(132)
    })
  })
})
