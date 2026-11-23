import { describe, expect, it } from 'vitest'
import type { EntityKey } from '@/core/contract'
import { placePilotLabel } from './placement'
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

  it('hides a blocked label unless the pilot is selected or inspected', () => {
    const occupied = [below, above, right, left]
    expect(placePilotLabel(center, 10, size, bounds, occupied)).toBeNull()
    expect(placePilotLabel(center, 10, size, bounds, occupied, true)).toEqual(below)
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
