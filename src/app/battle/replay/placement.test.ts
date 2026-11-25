import { describe, expect, it } from 'vitest'
import type { EntityKey } from '@/core/contract'
import { placeFightsWindow, placePilotLabel, placeReplayLabels, placeReplayPopover, placeShortMapWindow } from './placement'
import { makeLayout, type ReplayPilot } from './scene'

function pilot(key: EntityKey, side: number): ReplayPilot {
  return {
    entity: { key, side, name: key, charId: null, hasLog: false, sideSource: 'unknown', shipTypes: [] },
    ship: null, shipId: null, primaryEnemy: false, color: 'var(--color-side-n)', letter: null, deaths: [],
  }
}

it('chooses the corner that covers the fewest ships and prefers the upper right on ties', () => {
  const stage = { x: 0, y: 0, width: 900, height: 350 }
  const size = { width: 320, height: 164 }
  const node = (x: number, y: number) => ({ x, y, width: 18, height: 18 })
  expect(placeFightsWindow(stage, 36, 80, size, []).y).toBe(36)
  expect(placeFightsWindow(stage, 36, 80, size, [node(650, 87), node(140, 150)]).y).toBe(178)
  expect(placeFightsWindow(stage, 36, 80, size, [node(650, 87), node(650, 255)]).x).toBe(12)
})

it('uses the clear space between fleets if all three fight window corners cover ships', () => {
  const stage = { x: 0, y: 0, width: 900, height: 350 }
  const size = { width: 320, height: 164 }
  const pilots = [{ x: 650, y: 87 }, { x: 650, y: 255 }, { x: 140, y: 150 }]
    .map((point) => ({ ...point, width: 18, height: 18 }))
  const window = placeFightsWindow(stage, 36, 80, size, pilots)
  expect(window.x).toBeGreaterThanOrEqual(158)
  expect(window.x + window.width).toBeLessThanOrEqual(650)
})

it('keeps the zoom bar clickable even when a fight window corner would cover fewer hulls', () => {
  const stage = { x: 0, y: 0, width: 900, height: 350 }
  const size = { width: 320, height: 164 }
  const pilots = [{ x: 650, y: 87, width: 18, height: 18 }, { x: 650, y: 255, width: 18, height: 18 }]
  const zoom = { x: 8, y: 80, width: 153, height: 30 }
  const window = placeFightsWindow(stage, 36, 80, size, pilots, [zoom])
  expect(window.x >= zoom.x + zoom.width || window.y >= zoom.y + zoom.height).toBe(true)
})

it('clamps a saved overlay below the short map without changing its stored rectangle', () => {
  const saved = { x: 133, y: 90, width: 336, height: 540 }
  expect(placeShortMapWindow(saved, 156, 680)).toEqual({ ...saved, y: 156, height: 524 })
  expect(saved).toEqual({ x: 133, y: 90, width: 336, height: 540 })
  const below = { ...saved, y: 249, height: 164 }
  expect(placeShortMapWindow(below, 156, 680)).toEqual(below)
})

it.each([79, 120, 183, 397])('fits hulls and badges around controls at a map height of %s px', (height) => {
  const pilots = Array.from({ length: 49 }, (_, index) => pilot(`char:${index}`, index < 23 ? 0 : 1))
  for (const ship of pilots.slice(0, 23)) ship.entity.hasLog = true
  const layout = makeLayout(pilots, [0, 1], 882, height, 62)
  const chrome = [
    { x: 24, y: 12, width: 115, height: 16 }, { x: 661, y: 12, width: 197, height: 16 },
    { x: 24, y: 36, width: 226, height: 26 }, { x: 8, y: height - 34, width: 153, height: 26 },
  ]
  layout.placeVisible(new Set(pilots.map(({ entity }) => entity.key)), [], chrome)
  for (const [i, ship] of layout.nodes.entries()) {
    const ring = ship.radius + 2
    expect(ship.radius).toBe(i < 23 ? 12 : 8)
    expect(ship.x - ring).toBeGreaterThanOrEqual(0)
    expect(ship.x + ring).toBeLessThanOrEqual(882)
    expect(ship.y - ring).toBeGreaterThanOrEqual(0)
    expect(ship.y + ring).toBeLessThanOrEqual(height)
    expect(ship.x - ship.radius - 5).toBeGreaterThanOrEqual(0)
    expect(ship.y + ship.radius + 5).toBeLessThanOrEqual(height)
    for (const obstacle of chrome) {
      expect(ship.x >= obstacle.x && ship.x <= obstacle.x + obstacle.width
        && ship.y >= obstacle.y && ship.y <= obstacle.y + obstacle.height).toBe(false)
    }
    for (const other of layout.nodes.slice(0, i)) {
      expect(Math.hypot(ship.x - other.x, ship.y - other.y)).toBeGreaterThanOrEqual(ring + other.radius + 2)
    }
  }
})

it('keeps the pilot hull below the measured replay control inset', () => {
  const layout = makeLayout([pilot('char:1', 0)], [0, 1], 900, 350, 150)
  const ship = layout.byKey.get('char:1')!
  ship.y = 20
  layout.placeVisible(new Set(['char:1']), [])
  expect(ship.y - ship.radius).toBeGreaterThanOrEqual(150)
})

it.each([321, 411, 585])('keeps both fleets in separate horizontal halves on a 390×%s map', (height) => {
  const pilots = Array.from({ length: 41 }, (_, index) => pilot(`char:${index}`, index < 23 ? 0 : 1))
  for (const ship of pilots.slice(0, 17)) ship.entity.hasLog = true
  const layout = makeLayout(pilots, [0, 1], 390, height, 85)
  layout.placeVisible(new Set(pilots.map(({ entity }) => entity.key)), [])
  const left = layout.nodes.filter(({ entity }) => entity.side === 0)
  const right = layout.nodes.filter(({ entity }) => entity.side === 1)
  expect(Math.max(...left.map(({ x }) => x))).toBeLessThan(195)
  expect(Math.min(...right.map(({ x }) => x))).toBeGreaterThan(195)
})

describe('pilot label placement', () => {
  const center = { x: 100, y: 100 }
  const size = { width: 50, height: 16 }
  const bounds = { x: 0, y: 0, width: 200, height: 200 }
  const below = { x: 75, y: 115, ...size }
  const above = { x: 75, y: 69, ...size }
  const right = { x: 115, y: 92, ...size }
  const left = { x: 35, y: 92, ...size }

  it('tries below, above, right and left around previously placed labels and module icons', () => {
    expect(placePilotLabel(center, 10, size, bounds, [])).toEqual(below)
    expect(placePilotLabel(center, 10, size, bounds, [below])).toEqual(above)
    expect(placePilotLabel(center, 10, size, bounds, [below, above])).toEqual(right)
    expect(placePilotLabel(center, 10, size, bounds, [below, above, right])).toEqual(left)
  })

  it('searches farther for a required label and skips it when no space exists', () => {
    const occupied = [below, above, right, left]
    expect(placePilotLabel(center, 10, size, bounds, occupied)).toBeNull()
    expect(placePilotLabel(center, 10, size, bounds, occupied, true)).not.toBeNull()
    expect(placePilotLabel(center, 10, size, bounds, [bounds], true)).toBeNull()
  })

  it('keeps required labels in the stage when every slot is occupied', () => {
    const stage = { x: 0, y: 0, width: 40, height: 20 }
    const optional = { center: { x: 20, y: 10 }, radius: 10, size, bounds: stage, priority: 1, uploader: false, required: false }
    const inspected = { ...optional, priority: 3, required: true }
    const logged = { ...optional, priority: 2, uploader: true, required: true }
    const placed = placeReplayLabels([optional, logged, inspected], [stage], stage)

    for (const label of [inspected, logged]) {
      const rect = placed.get(label)!
      expect(rect).toMatchObject({ x: 0, width: 40, height: 16 })
      expect(rect.y).toBeGreaterThanOrEqual(0)
      expect(rect.y + rect.height).toBeLessThanOrEqual(stage.height)
    }
    expect(placed.has(optional)).toBe(false)
  })

  it('uses the full stage to keep required names clear of the replay controls', () => {
    const stage = { x: 0, y: 32, width: 120, height: 40 }
    const overlay = { x: 30, y: 35, width: 75, height: 39 }
    const shipRings = { x: 0, y: 32, width: 120, height: 40 }
    const required = { center: { x: 65, y: 55 }, radius: 10, size, bounds: stage, priority: 2, uploader: true, required: true }
    const placement = placeReplayLabels([required], [overlay, shipRings], stage, false, {
      bounds: { ...stage, y: 0, height: 76 }, obstacles: [overlay],
    })
    const rect = placement.get(required)!
    expect(rect.width).toBe(size.width)
    expect(rect.y + rect.height).toBeLessThanOrEqual(overlay.y)
  })

  it('uses free space across the fleet boundary before shortening a required name', () => {
    const stage = { x: 0, y: 0, width: 200, height: 100 }
    const ownSide = { ...stage, width: 65 }
    const required = { center: { x: 42, y: 55 }, radius: 10, size: { width: 110, height: 16 },
      bounds: ownSide, priority: 2, uploader: true, required: true }
    expect(placeReplayLabels([required], [], stage).get(required)?.width).toBe(110)
  })

  it('uses the full compact name when the standard name alone is wider than the map', () => {
    const stage = { x: 0, y: 0, width: 100, height: 90 }
    const required = { center: { x: 50, y: 40 }, radius: 10, size: { width: 103, height: 16 },
      compactSize: { width: 95, height: 12 }, bounds: stage, priority: 2, uploader: true, required: true }
    expect(placeReplayLabels([required], [], stage).get(required)).toMatchObject({ width: 95, height: 12, compact: true })
  })

  it('keeps a required name near its ship when full hull clearance would place it far away', () => {
    const stage = { x: 0, y: 0, width: 200, height: 100 }
    const hulls = { ...stage, width: 130 }
    const control = { x: 0, y: 0, width: 80, height: 32 }
    const required = { center: { x: 45, y: 45 }, radius: 12, size,
      bounds: stage, priority: 2, uploader: true, required: true }
    const rect = placeReplayLabels([required], [hulls, control], stage, false, { bounds: stage, obstacles: [control] }).get(required)!
    expect(rect.x).toBeLessThanOrEqual(85)
    expect(rect.y).toBeGreaterThanOrEqual(34)
  })

  it.each([79, 120, 183, 397])('keeps dense zoom labels within reach without overlap at %s px', (height) => {
    const stage = { x: 0, y: 0, width: 410, height }
    const labels = Array.from({ length: 25 }, (_, index) => ({
      center: { x: 25 + index % 9 * 36, y: height / 2 + (Math.floor(index / 9) - 1) * 23 },
      radius: 12, size: { width: 80, height: 16 }, compactSize: { width: 68, height: 12 },
      bounds: stage, priority: 2, uploader: true, required: true,
    }))
    const rings = labels.map(({ center: { x, y } }) => ({ x: x - 12, y: y - 12, width: 24, height: 24 }))
    const controls = [{ x: 0, y: 0, width: 135, height: 18 }]
    const placements = placeReplayLabels(labels, [...rings, ...controls], stage, true, { bounds: stage, obstacles: controls })
    const placed = [...placements.values()]
    expect(placed).toHaveLength(labels.length)
    for (const [label, rect] of placements) {
      expect(rect.width).toBe(rect.compact ? label.compactSize.width : label.size.width)
      const dx = Math.max(0, rect.x - label.center.x, label.center.x - rect.x - rect.width)
      const dy = Math.max(0, rect.y - label.center.y, label.center.y - rect.y - rect.height)
      expect(Math.hypot(dx, dy)).toBeLessThanOrEqual(40)
      expect([...placed, ...controls].some((other) => other !== rect && other.x < rect.x + rect.width
        && other.x + other.width > rect.x && other.y < rect.y + rect.height && other.y + other.height > rect.y)).toBe(false)
    }
  })
})

it('rejects a free slot more than 40 px away from a pilot', () => {
  const bounds = { x: 0, y: 0, width: 400, height: 300 }
  const wall = { x: 0, y: 0, width: 270, height: 300 }
  expect(placePilotLabel({ x: 100, y: 150 }, 14, { width: 60, height: 16 }, bounds, [wall], true)).toBeNull()
})

describe('replay popover placement', () => {
  const stage = { x: 8, y: 56, width: 1264, height: 278 }
  const trigger = { x: 120, y: 93, width: 78, height: 26 }
  const panel = { width: 180, height: 100 }

  it('uses the trigger left edge with or without a wider badge', () => {
    const expected = { x: trigger.x, y: 123, ...panel }
    expect(placeReplayPopover(trigger, panel, stage, 4)).toEqual(expected)
    expect(placeReplayPopover({ ...trigger, width: 106 }, panel, stage, 4)).toEqual(expected)
  })

  it('clamps within the left and right edges of a narrow stage', () => {
    const narrow = { ...stage, width: 182 }
    expect(placeReplayPopover({ ...trigger, x: 1 }, panel, narrow, 4)).toEqual({ x: 8, y: 123, ...panel })
    expect(placeReplayPopover(trigger, panel, narrow, 4)).toEqual({ x: 10, y: 123, ...panel })
  })

  it('opens above the trigger when the panel cannot fit beneath it', () => {
    expect(placeReplayPopover({ ...trigger, y: 220 }, panel, stage, 4)).toEqual({ x: 120, y: 116, ...panel })
  })

  it('limits the panel height to the clear side of a short stage', () => {
    expect(placeReplayPopover(trigger, panel, { ...stage, height: 120 }, 4))
      .toEqual({ x: 120, y: 123, width: 180, height: 53 })
  })
})

describe('unassigned replay row', () => {
  it.each([79, 120, 183, 397])('keeps eight neutral hulls below the midpoint at %s px', (height) => {
    const pilots = Array.from({ length: 49 }, (_, index) =>
      pilot(`char:${index}`, index < 25 ? 0 : index < 41 ? 1 : -1))
    const layout = makeLayout(pilots, [0, 1], 882, height)
    const visible = new Set(pilots.map(({ entity }) => entity.key))
    layout.placeVisible(visible, [])
    for (const node of layout.nodes.filter(({ entity }) => entity.side < 0)) {
      expect(node.y).toBeGreaterThan(height / 2)
      expect(node.y + node.radius + 5).toBeLessThanOrEqual(height)
      for (const other of layout.nodes.filter((other) => other !== node)) {
        expect(Math.hypot(node.x - other.x, node.y - other.y)).toBeGreaterThanOrEqual(Math.max(node.radius, other.radius) + 2)
      }
    }
  })

  it('keeps the seat of an unassigned ship as other ships enter and leave', () => {
    const layout = makeLayout([
      pilot('char:1', 0), pilot('char:2', -1), pilot('char:3', -1), pilot('char:4', -1),
    ], [0], 400, 340)
    layout.placeVisible(new Set(['char:2', 'char:4']), [])
    const left = layout.byKey.get('char:2')!
    const right = layout.byKey.get('char:4')!
    const x = right.x
    expect(left.y).toBe(right.y)
    expect(right.y).toBeGreaterThan(300)
    expect(right.x - left.x).toBeGreaterThan(16)

    layout.placeVisible(new Set(['char:3', 'char:4']), [])
    expect(right.x).toBe(x)
    expect(layout.byKey.get('char:3')!.x).toBe(left.x)
  })

  it('keeps occupied seat centers when the row has to fit more ships', () => {
    const pilots = Array.from({ length: 12 }, (_, index) => pilot(`char:${index}`, -1))
    const layout = makeLayout(pilots, [], 180, 300)
    layout.placeVisible(new Set(['char:0', 'char:1', 'char:2', 'char:3', 'char:4']), [])
    const initial = layout.nodes.slice(0, 5).map(({ x }) => x)
    layout.placeVisible(new Set(pilots.map(({ entity }) => entity.key)), [])
    initial.forEach((x, index) => expect(layout.nodes[index]!.x).toBeCloseTo(x))
  })

  it('adds seats above a full row without shrinking or overlapping the ship rings', () => {
    const pilots = Array.from({ length: 12 }, (_, index) => pilot(`char:${index}`, -1))
    const layout = makeLayout(pilots, [], 180, 300)
    layout.placeVisible(new Set(pilots.map(({ entity }) => entity.key)), [])
    const visible = layout.nodes
    expect(visible).toHaveLength(12)
    for (const [index, node] of visible.entries()) {
      expect(node.radius).toBe(8)
      expect(node.x - node.radius - 2).toBeGreaterThan(0)
      expect(node.x + node.radius + 2).toBeLessThan(180)
      for (const previous of visible.slice(0, index)) {
        expect(Math.hypot(node.x - previous.x, node.y - previous.y))
          .toBeGreaterThanOrEqual(node.radius + previous.radius + 4)
      }
    }
  })
})
