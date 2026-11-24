import { expect, it } from 'vitest'
import { createProjectilePlayback, projectileAt, projectilePerPair, projectileTravelMs, shotTravelMs } from './projectile'
import type { ReplayEdge } from './scene'

const source = { x: 10, y: 20 }
const target = { x: 110, y: 70 }

it('moves a shot or repair icon from source to destination in the arrival time', () => {
  for (const kind of ['damage', 'repair'] as const) {
    expect(projectileAt(kind, source, target, 0, false, 1).position).toEqual(source)
    expect(projectileAt(kind, source, target, shotTravelMs / 2, false, 1).position).toEqual({ x: 60, y: 45 })
    expect(projectileAt(kind, source, target, shotTravelMs, false, 1).position).toEqual(target)
  }
})

it('anchors continuous modules at the source and moves misses only to the end of their trace', () => {
  expect(projectileAt('ewar', source, target, shotTravelMs, false, 1).position).toEqual(source)
  expect(projectileAt('neut', source, target, shotTravelMs, false, 1).position).toEqual(source)
  expect(projectileAt('miss', source, target, shotTravelMs, false, 0.6).position).toEqual({ x: 70, y: 50 })
})

it('draws an icon at the target end as soon as the line is visible with reduced motion', () => {
  expect(projectileAt('damage', source, target, 0, true, 1).position).toEqual(target)
  expect(projectileAt('ewar', source, target, 0, true, 1).position).toEqual(target)
  expect(projectileAt('miss', source, target, 0, true, 0.6).position).toEqual({ x: 70, y: 50 })
})

it('keeps only the newest module on a directed pair, including different interaction kinds', () => {
  const prior = { from: 'A', to: 'B', age: 500, weapon: 'old' }
  const reply = { from: 'B', to: 'A', age: 200, weapon: 'reply' }
  const latest = { from: 'A', to: 'B', age: 100, weapon: 'new' }
  expect(projectilePerPair([prior, reply, latest])).toEqual([latest, reply])
})

it('uses 1,100 screen pixels per second between the travel clamps', () => {
  const at = { x: 0, y: 0 }
  expect(projectileTravelMs(at, { x: 100, y: 0 })).toBe(250)
  expect(projectileTravelMs(at, { x: 330, y: 0 })).toBeCloseTo(300)
  expect(projectileTravelMs(at, { x: 660, y: 0 })).toBeCloseTo(600)
  expect(projectileTravelMs(at, { x: 1500, y: 0 })).toBe(900)
})

it('keeps the oldest three shots in flight and queues the next one without dropping either endpoint', () => {
  const edge = (t: number): ReplayEdge => ({
    t, from: 'char:1', to: 'char:2', kind: 'damage', amount: 10, weapon: 'test gun',
    quality: 'Hits', repairType: null, ewar: null, sources: [], corroborated: false, strength: 0.5,
  })
  const shots = [edge(0), edge(25), edge(50), edge(75)]
  const playback = createProjectilePlayback()
  const first = playback.advance(shots, 75, true, 2000, () => 500)
  expect(first.map(({ start, end }) => [start, end])).toEqual([[0, 500], [25, 525], [50, 550], [500, 1000]])
  expect(first.filter(({ start }) => start <= 75)).toHaveLength(3)
  expect(playback.endpoints()).toEqual(new Set(['char:1', 'char:2']))
  expect(playback.advance(shots, 500, true, 2000, () => null)).toEqual(first)
  expect(first[0]?.arrived).toBe(false)
  first.forEach((flight) => { flight.arrived = true })
  expect(playback.endpoints().size).toBe(0)
  expect(playback.advance(shots, 3500, true, 2000, () => null)).toEqual([])
})
