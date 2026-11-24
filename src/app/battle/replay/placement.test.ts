import { describe, expect, it } from 'vitest'
import type { EntityKey } from '@/core/contract'
import { placeFightsWindow, placePilotLabel, placeReplayLabels, placeReplayPopover } from './placement'
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

it('keeps the pilot hull below the measured replay control inset', () => {
  const layout = makeLayout([pilot('char:1', 0)], [0, 1], 900, 350, 150)
  const ship = layout.byKey.get('char:1')!
  ship.y = 20
  layout.placeVisible(new Set(['char:1']), [])
  expect(ship.y - ship.radius).toBeGreaterThanOrEqual(150)
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
  it('keeps the seat of an unassigned ship as other ships enter and leave', () => {
    const layout = makeLayout([
      pilot('char:1', 0), pilot('char:2', -1), pilot('char:3', -1), pilot('char:4', -1),
    ], [0], 400, 340)
    layout.placeUnassigned(new Set(['char:2', 'char:4']))
    const left = layout.byKey.get('char:2')!
    const right = layout.byKey.get('char:4')!
    const x = right.x
    expect(left.y).toBe(right.y)
    expect(right.y).toBeGreaterThan(300)
    expect(right.x - left.x).toBeGreaterThan(16)

    layout.placeUnassigned(new Set(['char:3', 'char:4']))
    expect(right.x).toBe(x)
    expect(layout.byKey.get('char:3')!.x).toBe(left.x)
  })

  it('keeps occupied seat centers when the row has to fit more ships', () => {
    const pilots = Array.from({ length: 12 }, (_, index) => pilot(`char:${index}`, -1))
    const layout = makeLayout(pilots, [], 180, 300)
    layout.placeUnassigned(new Set(['char:0', 'char:1', 'char:2', 'char:3', 'char:4']))
    const initial = layout.nodes.slice(0, 5).map(({ x }) => x)
    layout.placeUnassigned(new Set(pilots.map(({ entity }) => entity.key)))
    initial.forEach((x, index) => expect(layout.nodes[index]!.x).toBeCloseTo(x))
  })

  it('fits a crowded row into the stage without overlapping the ship rings', () => {
    const pilots = Array.from({ length: 12 }, (_, index) => pilot(`char:${index}`, -1))
    const layout = makeLayout(pilots, [], 180, 300)
    layout.placeUnassigned(new Set(pilots.map(({ entity }) => entity.key)))
    const visible = layout.nodes
    expect(visible).toHaveLength(12)
    expect(visible[0]!.x - visible[0]!.radius - 2).toBeGreaterThan(0)
    expect(visible.at(-1)!.x + visible.at(-1)!.radius + 2).toBeLessThan(180)
    for (const [index, node] of visible.slice(1).entries()) {
      const previous = visible[index]!
      expect(node.x - previous.x).toBeGreaterThanOrEqual(node.radius + previous.radius + 4)
    }
  })
})
