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
})
