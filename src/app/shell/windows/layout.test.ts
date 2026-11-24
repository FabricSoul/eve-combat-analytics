import { describe, expect, it, vi } from 'vitest'
import { clampWindow, defaultWindowLayout, dockTarget, isPanel, loadWindowLayout, saveWindowLayout,
  windowIds, windowLayoutReducer, windowStorageKey, windowTitles } from './layout'
import type { PanelTab } from '../../state/view-store'

const viewport = { width: 1280, height: 752 }

describe('desktop window layout', () => {
  it('has a window for every side-panel tab, including 命中', () => {
    const tabs: PanelTab[] = ['roster', 'compare', 'hits', 'kills', 'fit']
    for (const tab of tabs) expect(windowIds).toContain(tab)
    expect(windowTitles.hits).toBe('命中')
    expect(isPanel('hits')).toBe(true)
    const popped = windowLayoutReducer(defaultWindowLayout(), { type: 'pop', id: 'hits', viewport })
    expect(popped.windows.hits.floating).toBe(true)
  })

  it('falls back to the default for a layout saved before the 命中 window existed', () => {
    const old = { version: 1, windows: Object.fromEntries(['roster', 'feed', 'timeline', 'compare', 'kills', 'fit'].map((id) => [id, { floating: false, hidden: false, minimized: false, rect: null }])), activePanel: 'roster', order: ['roster', 'feed', 'timeline', 'compare', 'kills', 'fit'] }
    const layout = loadWindowLayout({ getItem: () => JSON.stringify(old) })
    expect(layout).toEqual(defaultWindowLayout())
  })

  it('pops, raises, minimizes and redocks the same pane', () => {
    const initial = defaultWindowLayout()
    let layout = windowLayoutReducer(initial, { type: 'pop', id: 'feed', viewport })
    expect(layout.windows.feed).toMatchObject({ floating: true, hidden: false, minimized: false })
    expect(layout.order.at(-1)).toBe('feed')
    layout = windowLayoutReducer(layout, { type: 'pop', id: 'timeline', viewport })
    expect(layout.order.at(-1)).toBe('timeline')
    layout = windowLayoutReducer(layout, { type: 'focus', id: 'feed' })
    expect(layout.order.at(-1)).toBe('feed')
    layout = windowLayoutReducer(layout, { type: 'minimize', id: 'feed' })
    expect(layout.windows.feed.minimized).toBe(true)
    layout = windowLayoutReducer(layout, { type: 'dock', id: 'feed' })
    expect(layout.windows.feed).toMatchObject({ floating: false, hidden: false, minimized: true })
    expect(initial.windows.feed).toMatchObject({ floating: false, minimized: false })
  })

  it('selects a docked tab or hides a visible pane and reopens it in the same place', () => {
    let layout = windowLayoutReducer(defaultWindowLayout(), { type: 'toggle', id: 'compare' })
    expect(layout.activePanel).toBe('compare')
    layout = windowLayoutReducer(layout, { type: 'pop', id: 'compare', viewport })
    const rect = layout.windows.compare.rect
    layout = windowLayoutReducer(layout, { type: 'toggle', id: 'compare' })
    expect(layout.windows.compare).toMatchObject({ floating: true, hidden: true, rect })
    layout = windowLayoutReducer(layout, { type: 'toggle', id: 'compare' })
    expect(layout.windows.compare).toMatchObject({ floating: true, hidden: false, rect })
    expect(windowLayoutReducer(layout, { type: 'reset' })).toEqual(defaultWindowLayout())
  })

  it('round trips docking, position, size, minimization and tab selection', () => {
    const rect = { x: 88, y: 190, width: 410, height: 260 }
    const storage = new Map<string, string>()
    const adapter = { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value) } }
    let layout = windowLayoutReducer(defaultWindowLayout(), { type: 'toggle', id: 'compare' })
    layout = windowLayoutReducer(layout, { type: 'pop', id: 'compare', viewport })
    layout = windowLayoutReducer(layout, { type: 'position', id: 'compare', rect })
    layout = windowLayoutReducer(layout, { type: 'minimize', id: 'compare' })
    saveWindowLayout(layout, adapter)
    expect(loadWindowLayout(adapter)).toEqual(layout)
  })

  it('falls back for missing, broken, unsupported and invalid stored layouts', () => {
    const data = defaultWindowLayout()
    const invalid = [null, '{', JSON.stringify({ version: 99, ...data }),
      JSON.stringify({ version: 1, ...data, windows: { ...data.windows, unknown: data.windows.roster } }),
      JSON.stringify({ version: 1, ...data, windows: { ...data.windows, roster: { ...data.windows.roster, rect: { x: 0, y: 0, width: -4, height: 5 } } } })]
    for (const value of invalid) expect(loadWindowLayout({ getItem: () => value })).toEqual(data)
    expect(loadWindowLayout({ getItem: () => { throw new Error('blocked') } })).toEqual(data)
    const setItem = vi.fn(() => { throw new Error('full') })
    expect(() => saveWindowLayout(data, { setItem })).not.toThrow()
    expect(setItem).toHaveBeenCalledWith(windowStorageKey, expect.any(String))
  })

  it('keeps the window within the desktop and respects the compact title height', () => {
    expect(clampWindow({ x: 1300, y: 900, width: 12, height: 20 }, viewport))
      .toEqual({ x: 1060, y: 632, width: 220, height: 120 })
    expect(clampWindow({ x: 1300, y: 900, width: 300, height: 300 }, viewport, true))
      .toEqual({ x: 980, y: 718, width: 300, height: 300 })
  })

  it('snaps only to the original edge', () => {
    expect(dockTarget('roster', { x: 10, y: 150 }, viewport)).toBe('left')
    expect(dockTarget('compare', { x: 10, y: 150 }, viewport)).toBe('left')
    expect(dockTarget('feed', { x: 1260, y: 150 }, viewport)).toBe('right')
    expect(dockTarget('timeline', { x: 640, y: 742 }, viewport)).toBe('bottom')
    expect(dockTarget('feed', { x: 10, y: 400 }, viewport)).toBeNull()
    expect(dockTarget('timeline', { x: 640, y: 5 }, viewport)).toBeNull()
  })
})
