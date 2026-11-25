import { expect, it } from 'vitest'
import type { EntityKey } from '@/core/contract'
import { interactionWindow } from './layout-effects'
import { makeLayout, type ReplayEdge, type ReplayPilot } from './scene'

function pilot(id: number, side: number): ReplayPilot {
  return {
    entity: { key: `char:${id}`, name: String(id), charId: id, side, sideSource: 'br', hasLog: true, shipTypes: [] },
    ship: null, shipId: null, primaryEnemy: false, color: 'var(--color-side-0)', letter: null, deaths: [],
  }
}

it.each([79, 120, 183, 397, 579])('pulls two engaged fleets closer and keeps them settled at %s px', (height) => {
  const pilots = [pilot(1, 0), pilot(2, 0), pilot(3, 1), pilot(4, 1)]
  const present = new Set(pilots.map(({ entity }) => entity.key))
  const damage: ReplayEdge = { t: 1000, from: 'char:1', to: 'char:3', kind: 'damage', amount: 100,
    weapon: null, quality: 'Hits', repairType: null, ewar: null, sources: [], corroborated: false, strength: 0.5 }
  const edges = [damage, { ...damage, from: 'char:2' as const, to: 'char:4' as const }]
  const layout = makeLayout(pilots, [0, 1], 882, height)
  const gap = () => (layout.nodes[2]!.x + layout.nodes[3]!.x - layout.nodes[0]!.x - layout.nodes[1]!.x) / 2
  layout.placeVisible(present, [])
  const quiet = gap()
  layout.placeVisible(present, edges)
  expect(gap()).toBeLessThan(quiet - 5)
  const engaged = layout.nodes.map(({ x, y }) => [x, y])
  layout.placeVisible(present, edges)
  expect(layout.nodes.map(({ x, y }) => [x, y])).toEqual(engaged)
})

it.each([0, 16])('keeps identical positions during 125 quiet frames with %s ms clock steps', (step) => {
  const layout = makeLayout([pilot(1, 0), pilot(2, 0), pilot(3, 1), pilot(4, 0)], [0, 1], 660, 579)
  const present = new Set<EntityKey>(['char:1', 'char:2', 'char:3'])
  const positions = () => layout.nodes.filter(({ entity }) => present.has(entity.key)).map(({ x, y }) => [x, y])
  const interactions: ReplayEdge[] = [{
    t: 1000, from: 'char:1', to: 'char:3', kind: 'damage', amount: 100, weapon: null, quality: 'Hits',
    repairType: null, ewar: null, sources: [], corroborated: false, strength: 0.5,
  }]
  const [start, end] = interactionWindow(interactions, 1000, 3000)
  layout.placeVisible(present, interactions.slice(start, end))
  const initial = positions()

  for (let t = 0; t < 125 * 16; t += 16) {
    const [start, end] = interactionWindow(interactions, 5000 + t / 16 * step, 3000)
    expect(start).toBe(end)
    layout.placeVisible(present, interactions.slice(start, end))
    expect(positions()).toEqual(initial)
  }
  const next = new Set<EntityKey>([...present, 'char:4'])
  layout.placeVisible(next, [])
  expect(positions()).toEqual(initial)
})
