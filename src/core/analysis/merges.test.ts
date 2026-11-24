import { expect, it } from 'vitest'
import { battle, hit, log, other } from '../../../fixtures/states/analysis'
import type { EntityKey } from '../contract'
import { analyze } from './analyze'
import { suggestMerges } from './merges'

it('re-keys an unresolved ship and label to a character before totaling interactions', () => {
  const ship = other(null, 'Cruiser', 'Cruiser', 1001)
  const state = battle([log(1, 'Ace', 0, [
    hit(0, ship, 10), hit(1, 'Unresolved label', 20),
    hit(2, other('Rook Pilot', 'Frigate', 'Rook Pilot (Frigate)', 1000), 40),
  ])])
  const before = analyze(state)
  expect(before.entities['ship:1001:1']).toBeDefined()
  expect(before.entities['name:Unresolved label']).toBeDefined()
  state.identityMerges = [
    { from: 'ship:1001:1', to: 'char:3', setAt: 1 },
    { from: 'name:Unresolved label', to: 'char:3', setAt: 2 },
  ]
  const result = analyze(state)
  expect(result.entities['ship:1001:1']).toBeUndefined()
  expect(result.entities['name:Unresolved label']).toBeUndefined()
  expect(result.entities['char:3']).toMatchObject({ side: 1, shipTypes: ['Cruiser', 'Frigate'] })
  expect(result.interactions.map(({ to }) => to)).toEqual(['char:3', 'char:3', 'char:3'])
  expect(result.stats.find(({ key }) => key === 'char:3')).toMatchObject({ damageIn: 70, source: 'observed' })
})

it('ranks overlapping same-side hull matches and excludes simultaneous conflicting identities', () => {
  const ship = other(null, 'Cruiser', 'Cruiser', 1001)
  const from = 'ship:1001:1' as const
  const state = battle([log(1, 'Ace', 0, [
    // No typed named sightings so the anonymous actor remains unresolved.
    hit(0, ship, 10, { dir: 'in' }), hit(15, ship, 10, { dir: 'in' }),
    hit(1, other('Rook Pilot', 'Cruiser'), 10), hit(14, other('Rook Pilot', 'Cruiser'), 10),
    hit(3, other('Knight', 'Cruiser'), 10), hit(9, other('Knight', 'Cruiser'), 10),
    hit(0, other('Bishop', 'Cruiser'), 10, { dir: 'in' }), hit(15, other('Bishop', 'Cruiser'), 10),
    hit(1, other('Wing', 'Cruiser'), 10), hit(12, other('Wing', 'Cruiser'), 10),
  ])])
  const analysis = analyze(state)
  expect(suggestMerges(analysis, from).map(({ to }) => to)).toEqual(['char:3', 'char:6'] satisfies EntityKey[])
  expect(suggestMerges(analysis, 'char:3')).toEqual([])
})
