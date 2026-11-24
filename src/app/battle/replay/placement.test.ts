import { describe, expect, it } from 'vitest'
import type { EntityKey } from '@/core/contract'
import { placePilotLabel, placeReplayPopover } from './placement'
import { makeLayout, type ReplayPilot } from './scene'

function pilot(key: EntityKey, side: number): ReplayPilot {
  return {
    entity: { key, side, name: key, charId: null, hasLog: false, sideSource: 'unknown', shipTypes: [] },
    ship: null, shipId: null, primaryEnemy: false, color: 'var(--color-side-n)', letter: null, deaths: [],
  }
}

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
})

it('places required pilot labels without overlapping, even when all nearby spots are occupied', () => {
  const size = { width: 60, height: 16 }
  const bounds = { x: 0, y: 0, width: 400, height: 300 }
  const wall = { x: 0, y: 20, width: 270, height: 250 }
  const label = placePilotLabel({ x: 100, y: 150 }, 14, size, bounds, [wall], true)
  expect(label).not.toBeNull()
  expect(label!.x).toBeGreaterThanOrEqual(272)
  expect(placePilotLabel({ x: 100, y: 150 }, 14, size, bounds, [bounds], true)).toBeNull()
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
