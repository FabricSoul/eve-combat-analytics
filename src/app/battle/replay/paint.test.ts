// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import type { EntityKey } from '@/core/contract'
import { makePainter } from './paint'
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
    const frame = { t: 500, selected: null, focusOnly: false, reducedMotion: false, playing: false }
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
  const frame = { t: 500, selected: null, focusOnly: false, reducedMotion: false, playing: false, pausedElapsed: 0 }
  const initial = painter.paint(layout, [edge], [], present, frame, 500, 400)
  expect(under.probe.arc.mock.calls.some(([, , radius]) => radius > 10)).toBe(true)

  under.probe.arc.mockClear()
  const settled = painter.paint(layout, [edge], [], present, { ...frame, pausedElapsed: 3000 }, 500, 400)
  expect(under.probe.arc).not.toHaveBeenCalled()
  expect(settled.positions.get(layout.nodes[1]!)).toEqual({ x: 350, y: 200 })
  expect(initial.animating).toBe(true)
  expect(settled.animating).toBe(false)
})
