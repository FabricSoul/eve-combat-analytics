import { describe, expect, it } from 'vitest'
import { defaultModules, moduleLayoutReducer, keyboardDrop, loadModules, saveModules } from './modules'

describe('battle modules', () => {
  it('lays out the default three areas and supports in-area and cross-area moves', () => {
    const initial = defaultModules()
    expect(initial.areas).toEqual([['feed', 'compare'], ['roster', 'kills'], ['hits', 'lanes']])
    const moved = moduleLayoutReducer(initial, { type: 'move', id: 'hits', area: 0, index: 1 })
    expect(moved.areas).toEqual([['feed', 'hits', 'compare'], ['roster', 'kills'], ['lanes']])
    const reordered = moduleLayoutReducer(moved, { type: 'move', id: 'hits', area: 0, index: 0 })
    expect(reordered.areas[0]).toEqual(['hits', 'feed', 'compare'])
  })

  it('supports Alt-arrow movement within and between visible columns', () => {
    const layout = defaultModules()
    expect(keyboardDrop(layout, 'hits', 'ArrowLeft', 3)).toEqual({ type: 'move', id: 'hits', area: 1, index: 0 })
    expect(keyboardDrop(layout, 'feed', 'ArrowDown', 3)).toEqual({ type: 'move', id: 'feed', area: 0, index: 1 })
    expect(keyboardDrop(layout, 'lanes', 'ArrowRight', 2)).toBeNull()
  })

  it('restores order, collapsed state, floating geometry, visibility and stage height', () => {
    let layout = defaultModules()
    layout = moduleLayoutReducer(layout, { type: 'move', id: 'hits', area: 0, index: 0 })
    layout = moduleLayoutReducer(layout, { type: 'collapse', id: 'kills' })
    layout = moduleLayoutReducer(layout, { type: 'toggle', id: 'lanes' })
    layout = moduleLayoutReducer(layout, { type: 'float', id: 'feed', rect: { x: 10, y: 20, width: 340, height: 300 } })
    layout = moduleLayoutReducer(layout, { type: 'stage', height: 440 })
    let value = ''
    saveModules(layout, { setItem: (_, next) => { value = next } })
    expect(loadModules({ getItem: () => value })).toEqual(layout)
    expect(loadModules({ getItem: () => JSON.stringify({ ...JSON.parse(value), version: 2 }) })).toEqual(defaultModules())
    expect(loadModules({ getItem: () => value.replace('"kills"', '"feed"') })).toEqual(defaultModules())
    expect(moduleLayoutReducer(layout, { type: 'reset' })).toEqual(defaultModules())
  })

  it('persists replay windows in the layout and discards heights saved under version 3', () => {
    const defaults = defaultModules()
    expect(defaults.replay).toEqual({
      overlays: { legend: { open: false, collapsed: false, rect: null }, fights: { open: true, collapsed: false, rect: null } },
      order: ['legend', 'fights'],
    })
    const moved = { x: 293, y: 486, width: 250, height: 430 }
    const opened = moduleLayoutReducer(defaults, { type: 'replay', action: { type: 'toggle', id: 'legend' } })
    const positioned = moduleLayoutReducer(opened, { type: 'replay', action: { type: 'position', id: 'legend', rect: moved } })
    const collapsed = moduleLayoutReducer(positioned, { type: 'replay', action: { type: 'minimize', id: 'legend' } })
    let saved = ''
    saveModules(collapsed, { setItem: (_, value) => { saved = value } })
    const reopened = loadModules({ getItem: () => saved })
    expect(reopened.replay.overlays.legend).toEqual({ open: true, collapsed: true, rect: moved })
    expect(reopened.replay.order).toEqual(['fights', 'legend'])
    expect(loadModules({ getItem: () => JSON.stringify({ ...JSON.parse(saved), version: 3, stageHeight: 400 }) })).toEqual(defaults)
    expect(moduleLayoutReducer(reopened, { type: 'reset' })).toEqual(defaults)
  })
})
