import { describe, expect, it } from 'vitest'
import type { EntityKey } from '@/core/contract'
import { placePilotLabel } from './placement'
import { makeLayout, type ReplayEdge, type ReplayPilot } from './scene'

function pilot(key: EntityKey, side: number): ReplayPilot {
  return {
    entity: { key, side, name: key, charId: null, hasLog: false, sideSource: 'unknown', shipTypes: [] },
    ship: null, shipId: null, primaryEnemy: false, color: 'var(--color-side-n)', letter: null, deaths: [],
  }
}

function shot(t: number, from: EntityKey, to: EntityKey): ReplayEdge {
  return {
    t, from, to, kind: 'damage', amount: 100, weapon: null, quality: null,
    repairType: null, ewar: null, sources: [], corroborated: false, strength: 1,
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
  it('shows only live unassigned endpoints and the selected pilot, all on the same row', () => {
    const layout = makeLayout([
      pilot('char:1', 0), pilot('char:2', -1), pilot('char:3', -1), pilot('char:4', -1), pilot('char:5', -1),
    ], [0], 400, 340)
    const edges = [shot(1000, 'char:1', 'char:3'), shot(5000, 'char:2', 'char:1'), shot(7000, 'char:1', 'char:5')]
    const visible = [...layout.placeUnassigned(edges.slice(1, 2), 'char:4', false)]
    expect(visible.map(({ entity }) => entity.key)).toEqual(['char:2', 'char:4'])
    expect(visible[0]?.y).toBe(visible[1]?.y)
    expect(visible[0]?.y).toBeGreaterThan(300)
    expect((visible[1]?.x ?? 0) - (visible[0]?.x ?? 0)).toBeGreaterThan(16)

    expect([...layout.placeUnassigned([], 'char:4', false)].map(({ entity }) => entity.key)).toEqual(['char:4'])
    expect([...layout.placeUnassigned(edges.slice(1, 2), 'char:4', true)].map(({ entity }) => entity.key)).toEqual(['char:4'])
  })

  it('fits a crowded row into the stage without overlapping the ship rings', () => {
    const pilots = Array.from({ length: 12 }, (_, index) => pilot(`char:${index}`, -1))
    const layout = makeLayout(pilots, [], 180, 300)
    const visible = [...layout.placeUnassigned(pilots.map(({ entity }) => shot(1000, entity.key, entity.key)), null, false)]
    expect(visible).toHaveLength(12)
    expect(visible[0]!.x - visible[0]!.radius - 2).toBeGreaterThan(0)
    expect(visible.at(-1)!.x + visible.at(-1)!.radius + 2).toBeLessThan(180)
    for (const [index, node] of visible.slice(1).entries()) {
      const previous = visible[index]!
      expect(node.x - previous.x).toBeGreaterThanOrEqual(node.radius + previous.radius + 4)
    }
  })
})
