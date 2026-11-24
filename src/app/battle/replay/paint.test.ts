// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { EntityKey } from '@/core/contract'
import { makePainter, missedTracerAt } from './paint'
import { createProjectilePlayback } from './projectile'
import { makeLayout, type ReplayEdge, type ReplayPilot } from './scene'

function pilot(id: number): ReplayPilot {
  return {
    entity: { key: `char:${id}`, side: id, name: String(id), charId: id, hasLog: false, sideSource: 'br', shipTypes: [] },
    ship: null, shipId: null, primaryEnemy: false, color: 'var(--color-side-n)', letter: null, deaths: [],
  }
}

function canvasProbe() {
  const methods = {
    clearRect: vi.fn(), setLineDash: vi.fn(), beginPath: vi.fn(), stroke: vi.fn(), fill: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), arc: vi.fn(), measureText: vi.fn(() => ({ width: 36 })),
    strokeText: vi.fn(), fillText: vi.fn(),
  }
  return { probe: methods, context: methods as unknown as CanvasRenderingContext2D }
}

describe('replay paint anchors', () => {
  it('uses the ship marker position for hit rings, numbers and the near tracer endpoint', () => {
    const layout = makeLayout([pilot(1), pilot(2)], [1, 2], 500, 400)
    const [source, target] = layout.nodes
    Object.assign(source!, { x: 100, y: 180 })
    Object.assign(target!, { x: 350, y: 200 })
    const edge: ReplayEdge = {
      t: 0, from: 'char:1', to: 'char:2', kind: 'damage', amount: 500, weapon: null,
      quality: null, repairType: null, ewar: null, sources: [], corroborated: false, strength: 1,
    }
    const under = canvasProbe()
    const over = canvasProbe()
    const paint = makePainter(under.context, over.context, document.createElement('div'), () => {}).paint
    const frame = { t: 400, selected: null, focusOnly: false, reducedMotion: false, playing: false }
    const present = new Set<EntityKey>(['char:1', 'char:2'])
    const moving = paint(layout, [edge], [], present, frame, 500, 400)
    const sourceMarker = moving.positions.get(source!)
    const targetMarker = moving.positions.get(target!)

    expect(sourceMarker).toEqual({ x: 100, y: 180 })
    expect(targetMarker).toBeDefined()
    expect(targetMarker).not.toEqual({ x: 350, y: 200 })
    expect(under.probe.moveTo).toHaveBeenCalledWith(sourceMarker!.x, sourceMarker!.y)
    expect(under.probe.lineTo).toHaveBeenCalledWith(targetMarker!.x, targetMarker!.y)
    expect(under.probe.arc.mock.calls.some(([x, y]) => x === targetMarker!.x && y === targetMarker!.y)).toBe(true)
    expect(over.probe.fillText.mock.calls[0]?.[1]).toBeCloseTo(targetMarker!.x + target!.radius + 4 + 36)
    expect(over.probe.fillText.mock.calls[0]?.[2]).toBeCloseTo(targetMarker!.y - target!.radius - 17 - 17 * 150 / 1200)

    const still = paint(layout, [edge], [], present, { ...frame, reducedMotion: true }, 500, 400)
    expect(still.positions.get(target!)).toEqual({ x: 350, y: 200 })
    expect(under.probe.lineTo).toHaveBeenLastCalledWith(350, 200)
  })
})

it('clears temporary pulse rings as wall time advances at the same paused instant', () => {
  const layout = makeLayout([pilot(1), pilot(2)], [1, 2], 500, 400)
  Object.assign(layout.nodes[0]!, { x: 100, y: 180 })
  Object.assign(layout.nodes[1]!, { x: 350, y: 200 })
  const edge: ReplayEdge = {
    t: 0, from: 'char:1', to: 'char:2', kind: 'damage', amount: 500, weapon: null,
    quality: null, repairType: null, ewar: null, sources: [], corroborated: false, strength: 1,
  }
  const under = canvasProbe()
  const over = canvasProbe()
  const host = document.createElement('div')
  host.style.setProperty('--dur-edge-fade', '3s')
  const painter = makePainter(under.context, over.context, host, () => {})
  const present = new Set<EntityKey>(['char:1', 'char:2'])
  const frame = { t: 400, selected: null, focusOnly: false, reducedMotion: false, playing: false, pausedElapsed: 0 }
  const initial = painter.paint(layout, [edge], [], present, frame, 500, 400)
  expect(under.probe.arc.mock.calls.some(([, , radius]) => radius > 10)).toBe(true)

  under.probe.arc.mockClear()
  const settled = painter.paint(layout, [edge], [], present, { ...frame, pausedElapsed: 3000 }, 500, 400)
  expect(under.probe.arc).not.toHaveBeenCalled()
  expect(settled.positions.get(layout.nodes[1]!)).toEqual({ x: 350, y: 200 })
  expect(initial.animating).toBe(true)
  expect(settled.animating).toBe(false)
})

describe('miss and paused-shot encoding', () => {
  const edge: ReplayEdge = {
    t: 0, from: 'char:1', to: 'char:2', kind: 'damage', amount: 500, weapon: null, quality: 'Hits',
    repairType: null, ewar: null, sources: [], corroborated: false, strength: 1,
  }
  const frame = { t: 125, selected: null, focusOnly: false, reducedMotion: false, playing: false, pausedElapsed: 2000 }
  function draw(sample: ReplayEdge) {
    const layout = makeLayout([pilot(1), pilot(2)], [1, 2], 500, 400)
    Object.assign(layout.nodes[0]!, { x: 100, y: 180 })
    Object.assign(layout.nodes[1]!, { x: 350, y: 180 })
    const under = canvasProbe()
    const over = canvasProbe()
    const painter = makePainter(under.context, over.context, document.createElement('div'), () => {})
    const present = new Set<EntityKey>(['char:1', 'char:2'])
    const frameResult = painter.paint(layout, [sample], [], present, frame, 500, 400)
    return { under: under.probe, over: over.probe, painter, ...frameResult }
  }

  it('marks a miss endpoint with × and makes the dashed trace and marker hoverable', () => {
    const result = draw({ ...edge, kind: 'miss', amount: 0 })
    expect(result.over.moveTo).toHaveBeenCalledWith(261, 176)
    expect(result.over.lineTo).toHaveBeenCalledWith(269, 184)
    expect(result.over.moveTo).toHaveBeenCalledWith(269, 176)
    expect(result.over.lineTo).toHaveBeenCalledWith(261, 184)
    expect(result.under.setLineDash).toHaveBeenCalledWith([2, 4])
    expect(missedTracerAt(result.misses, { x: 140, y: 184 })).toBe(true)
    expect(missedTracerAt(result.misses, { x: 267, y: 180 })).toBe(true)
    expect(missedTracerAt(result.misses, { x: 300, y: 180 })).toBe(false)
    expect(missedTracerAt(result.misses, { x: 140, y: 200 })).toBe(false)
    result.over.lineTo.mockClear()
    result.painter.paintSample('miss', 90, 34, 250, false)
    expect(result.over.lineTo).toHaveBeenCalledTimes(2)
  })

  it('keeps a paused hit mid-flight on a solid trace without a miss marker or an impact', () => {
    const result = draw(edge)
    expect(result.under.setLineDash.mock.calls.every(([dash]) => dash.length === 0)).toBe(true)
    const head = result.under.lineTo.mock.calls.at(-1)?.[0]
    expect(head).toBeGreaterThan(100)
    expect(head).toBeLessThan(350)
    expect(result.over.arc).toHaveBeenCalled()
    expect(result.over.lineTo).not.toHaveBeenCalled()
    expect(result.over.fillText).not.toHaveBeenCalled()
    expect(result.misses).toEqual([])
  })
})

it('renders the landing frame after changing focus and outliving the configured fade', () => {
  const layout = makeLayout([pilot(1), pilot(2)], [1, 2], 500, 400)
  Object.assign(layout.nodes[0]!, { x: 100, y: 180 })
  Object.assign(layout.nodes[1]!, { x: 350, y: 180 })
  const edge: ReplayEdge = {
    t: 0, from: 'char:1', to: 'char:2', kind: 'damage', amount: 10, weapon: null, quality: 'Hits',
    repairType: null, ewar: null, sources: [], corroborated: false, strength: 0.5,
  }
  const under = canvasProbe()
  const over = canvasProbe()
  const host = document.createElement('div')
  host.style.setProperty('--dur-edge-fade', '60ms')
  const playback = createProjectilePlayback()
  const { paint } = makePainter(under.context, over.context, host, () => {}, playback)
  const present = new Set<EntityKey>(['char:1', 'char:2'])
  const frame = { t: 125, selected: null, focusOnly: false, reducedMotion: false, playing: true }
  paint(layout, [edge], [], present, frame, 500, 400)
  expect(playback.endpoints()).toEqual(present)
  over.probe.arc.mockClear()
  const arrived = paint(layout, [], [], playback.endpoints(), { ...frame, t: 300, selected: 'char:9', focusOnly: true }, 500, 400)
  const stop = arrived.positions.get(layout.nodes[1]!)!
  expect(over.probe.arc).toHaveBeenCalledWith(stop.x, stop.y, 2.5, 0, Math.PI * 2)
  expect(playback.endpoints().size).toBe(0)
})

it('paints legend effects from generic shapes, without loading icons or drawing text', async () => {
  const canvas = canvasProbe()
  const painter = makePainter(canvas.context, canvas.context, document.createElement('div'), () => {})
  const load = vi.fn()
  vi.stubGlobal('Image', class {
    onerror: (() => void) | null = null
    set src(value: string) { load(value); this.onerror?.() }
  })
  try {
    for (const effect of ['damage', 'repair', 'point', 'neut', 'miss'] as const) painter.paintSample(effect, 90, 28, 250, true)
    await vi.dynamicImportSettled()
    for (const effect of ['damage', 'repair', 'point', 'neut', 'miss'] as const) painter.paintSample(effect, 90, 28, 250, true)
    expect(canvas.probe.lineTo).toHaveBeenCalled()
    expect(load).not.toHaveBeenCalled()
    expect(canvas.probe.strokeText).not.toHaveBeenCalled()
    expect(canvas.probe.fillText).not.toHaveBeenCalled()
  } finally {
    vi.unstubAllGlobals()
  }
})

it('replaces missing map module art with a small shape and preserves the name for hit testing', async () => {
  const layout = makeLayout([pilot(1), pilot(2)], [1, 2], 500, 400)
  Object.assign(layout.nodes[0]!, { x: 100, y: 180 })
  Object.assign(layout.nodes[1]!, { x: 350, y: 200 })
  // Synthetic name deliberately absent from the module catalog.
  const weapon = 'Test launcher without a module icon'
  const edge: ReplayEdge = {
    t: 0, from: 'char:1', to: 'char:2', kind: 'damage', amount: 500, weapon,
    quality: null, repairType: null, ewar: null, sources: [], corroborated: false, strength: 1,
  }
  const under = canvasProbe()
  const over = canvasProbe()
  const painter = makePainter(under.context, over.context, document.createElement('div'), () => {})
  const present = new Set<EntityKey>(['char:1', 'char:2'])
  const frame = { t: 250, selected: null, focusOnly: false, reducedMotion: true, playing: false }
  painter.paint(layout, [edge], [], present, frame, 500, 400)
  await vi.dynamicImportSettled()
  const painted = painter.paint(layout, [edge], [], present, frame, 500, 400)
  expect(over.probe.strokeText).not.toHaveBeenCalled()
  expect(over.probe.fillText).not.toHaveBeenCalled()
  expect(over.probe.lineTo).toHaveBeenCalled()
  expect(painted.modules).toEqual([{ name: weapon, rect: expect.objectContaining({ width: 10, height: 10 }) }])
})
