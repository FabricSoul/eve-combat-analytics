import { describe, expect, it } from 'vitest'
import { defaultModules, moduleLayoutReducer, keyboardDrop, loadModules, replayHeightBounds, saveModules } from './modules'

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

  it('persists current replay windows and returns the entire layout to default for other versions', () => {
    const defaults = defaultModules()
    expect(defaults.replay).toEqual({
      overlays: { legend: { open: false, collapsed: false, rect: null }, fights: { open: true, collapsed: null, rect: null } },
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
    const snapshot = JSON.parse(saved)
    for (const version of [3, 4, 5, snapshot.version + 1, undefined]) {
      expect(loadModules({ getItem: () => JSON.stringify({ ...snapshot, version, stageHeight: 400 }) }),
        `stored version ${version}`).toEqual(defaults)
    }
    expect(moduleLayoutReducer(reopened, { type: 'reset' })).toEqual(defaults)
  })

  it('budgets the timeline inside the default stage height and leaves at least 220px for modules where possible', () => {
    expect(replayHeightBounds(800, 744, 176)).toMatchObject({ initial: 318 })
    expect(replayHeightBounds(940, 884, 176)).toMatchObject({ initial: 405 })
    expect(replayHeightBounds(1500, 1444, 150)).toMatchObject({ initial: 778 })
    expect(replayHeightBounds(680, 624, 150)).toMatchObject({ initial: 252 })
  })

  it('clamps the combined stage to 300px and 75% while keeping the timeline intact', () => {
    expect(replayHeightBounds(800, 744, 176)).toEqual({ min: 122, max: 422, initial: 318, fixedHeight: 178 })
    expect(replayHeightBounds(940, 884, 200)).toEqual({ min: 98, max: 503, initial: 381, fixedHeight: 202 })
    expect(replayHeightBounds(400, 344, 150)).toEqual({ min: 148, max: 148, initial: 148, fixedHeight: 152 })
    expect(replayHeightBounds(320, 264, 150)).toEqual({ min: 148, max: 148, initial: 148, fixedHeight: 152 })
  })

  it('includes rendered touch chrome and gives the map floor priority on a short workspace', () => {
    expect(replayHeightBounds(800, 744, 253, 46, 140)).toEqual({
      min: 140, max: 301, initial: 197, fixedHeight: 299,
    })
    expect(replayHeightBounds(500, 444, 253, 46, 140)).toEqual({
      min: 140, max: 140, initial: 140, fixedHeight: 299,
    })
  })

  it('keeps a fine-pointer map at the all-layers minimum even when it consumes the module reserve', () => {
    expect(replayHeightBounds(680, 622, 331, 2, 0)).toEqual({
      min: 79, max: 177, initial: 79, fixedHeight: 333,
    })
  })

  it('remembers an explicit fights collapse override in the current layout', () => {
    const expanded = moduleLayoutReducer(defaultModules(), { type: 'replay', action: { type: 'collapse', id: 'fights', collapsed: false } })
    let saved = ''
    saveModules(expanded, { setItem: (_, value) => { saved = value } })
    expect(loadModules({ getItem: () => saved }).replay.overlays.fights.collapsed).toBe(false)
  })
})
