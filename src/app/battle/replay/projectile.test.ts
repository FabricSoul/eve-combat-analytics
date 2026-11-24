import { expect, it } from 'vitest'
import { projectileAt, projectilePerPair, shotTravelMs } from './projectile'

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
