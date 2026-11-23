import { expect, it } from 'vitest'
import { at, battle, event, hit, kill, log, other, pilot } from '../../../fixtures/states/analysis'
import type { SideOverride, SideSubject } from '../contract'
import { analyze } from './analyze'

const manual = (subject: SideSubject, side: number, order: number): SideOverride =>
  ({ subject, side, source: 'manual', setAt: at(order) })

const reps = (count: number, target: string, start = 0) =>
  Array.from({ length: count }, (_, i) => event(start + i, target, {
    kind: 'repair', dir: 'out', amount: 10, repairType: 'armor', module: null,
  }))

it('uses BR affiliation over uploaded and indexed ESI sides and reports unknowns separately', () => {
  const state = battle([
    log(1, 'Ace', 1, [hit(0, 'Bishop', 10), hit(1, 'Unknown', 10), hit(2, other(null, 'Cruiser', 'Cruiser', 1001), 10)]),
    log(2, 'Wing', 0, []),
  ], [kill(1, 1, pilot(1, 100, 1000), [])])
  state.names = { ...state.names, Ace: { charId: 1, side: 1 } }
  expect(analyze(state).entities).toMatchObject({
    'char:1': { side: 0, sideSource: 'br' },
    'char:2': { side: 0, sideSource: 'esi' },
    'char:4': { side: 1, sideSource: 'esi' },
    'name:Unknown': { side: -1, sideSource: 'unknown' },
    'ship:1001:1': { side: 1, sideSource: 'unknown' },
  })
})

it('uses killmail affiliation for manual groups before uploaded affiliation and gives manual characters priority', () => {
  const state = battle([
    { ...log(1, 'Ace', 0, reps(30, 'Rook')), corpId: 300 },
  ], [kill(1, 0, { ...pilot(1, 100, 1000), allyId: 500 }, [pilot(2, 100, 1001)])])
  state.sideOverrides = [manual('corp:100', 1, 1), manual('char:1', 0, 2), manual('corp:300', 0, 3)]
  let result = analyze(state)
  expect(result.entities['char:1']).toMatchObject({ side: 0, sideSource: 'manual' })
  expect(result.entities['char:2']).toMatchObject({ side: 1, sideSource: 'manual' })
  expect(result.sideOverrides).toEqual([])

  state.sideOverrides.push(manual('char:1', -1, 4))
  result = analyze(state)
  expect(result.entities['char:1']).toMatchObject({ side: 1, sideSource: 'manual' })
  expect(result.sideOverrides).toEqual([])

  state.sideOverrides.push(manual('ally:500', 0, 5))
  expect(analyze(state).entities['char:1']).toMatchObject({ side: 0, sideSource: 'manual' })
})

it('applies manual groups from uploads and name entries and treats a latest removal as absent', () => {
  const state = battle([
    { ...log(1, 'Ace', 0, [hit(0, 'Wing', 5), hit(1, 'Medic', 7), hit(2, 'Rook', 9)]), corpId: 100, allyId: 500 },
  ])
  state.names = {
    ...state.names,
    Wing: { charId: 2, side: 0, corpId: 100 },
    Medic: { charId: 5, side: 0, allyId: 500 },
  }
  state.sideOverrides = [
    manual('corp:100', 1, 1), manual('ally:500', 0, 2), manual('ally:500', -1, 3), manual('char:3', 0, 4),
  ]
  const result = analyze(state)
  expect(result.entities).toMatchObject({
    'char:1': { side: 1, sideSource: 'manual' },
    'char:2': { side: 1, sideSource: 'manual' },
    'char:5': { side: 0, sideSource: 'esi' },
    'char:3': { side: 0, sideSource: 'manual' },
  })
  expect(result.timeline.damageBySide).toEqual({ 0: [0, 0, 0], 1: [5, 7, 9] })
  expect(result.coverage[1]).toMatchObject({ known: 2, withLog: 1 })
})

it.each([
  [19, 0, false],
  [20, 0, true],
  [84, 16, false],
  [17, 3, true],
])('classifies %i friendly-side and %i opposing-side repairs with the expected thresholds', (friendly, opposing, eligible) => {
  const state = battle([
    log(1, 'Ace', 0, [...reps(friendly, 'Rook'), ...reps(opposing, 'Medic', friendly)]),
  ], [kill(1, 0, pilot(1, 100, 1000), [])])
  const result = analyze(state)
  expect(result.entities['char:1']).toMatchObject({ side: eligible ? 1 : 0, sideSource: eligible ? 'log' : 'br' })
  expect(result.sideOverrides).toEqual(eligible ? [
    { subject: 'char:1', side: 1, source: 'log', reason: `repaired side 1: ${friendly} events, damaged side 0: 0 events`, setAt: at(60) },
  ] : [])
})

it.each([[49, false], [50, true]])('requires 50 own damage reports (%i)', (count, eligible) => {
  const damage = Array.from({ length: count }, (_, i) => hit(i, 'Medic', 8))
  const reverseOnly = Array.from({ length: 20 }, (_, i) => hit(i + 60, 'Ace', 8, { dir: 'in' }))
  const state = battle([log(1, 'Ace', 0, damage), log(5, 'Medic', 0, reverseOnly)])
  const result = analyze(state)
  expect(result.entities['char:1']).toMatchObject({ side: eligible ? 1 : 0, sideSource: eligible ? 'log' : 'esi' })
  expect(result.sideOverrides).toHaveLength(eligible ? 1 : 0)
})

it('re-evaluates once after excluding a target whose side was inferred from log evidence', () => {
  const state = battle([
    log(1, 'Ace', 0, reps(20, 'Rook')),
    log(2, 'Wing', 0, [...reps(20, 'Rook'), ...reps(4, 'Ace', 20)]),
    log(5, 'Medic', 0, [...reps(20, 'Rook'), ...reps(4, 'Wing', 20)]),
  ])
  const result = analyze(state)
  expect(result.sideOverrides.map(({ subject }) => subject)).toEqual(['char:1', 'char:2'])
  expect(result.entities['char:5']).toMatchObject({ side: 0, sideSource: 'esi' })
  expect(analyze({ ...state, logs: [...state.logs].reverse() })).toEqual(result)
})

it('uses decisive repair evidence when the damage evidence is split', () => {
  const damage = Array.from({ length: 50 }, (_, i) => hit(i, i < 30 ? 'Medic' : 'Rook', 8))
  const result = analyze(battle([log(1, 'Ace', 0, [...reps(20, 'Rook'), ...damage])]))
  expect(result.sideOverrides).toMatchObject([
    { subject: 'char:1', side: 1, reason: 'repaired side 1: 20 events, damaged side 0: 30 events' },
  ])
})

it.each([0, 1])('keeps original side %i when qualifying repair and damage evidence disagree', (side) => {
  const damage = Array.from({ length: 150 }, (_, i) => hit(i, 'Medic', 8))
  const result = analyze(battle([log(1, 'Ace', side, [...reps(20, 'Medic'), ...damage])]))
  expect(result.entities['char:1']).toMatchObject({ side, sideSource: 'esi' })
  expect(result.sideOverrides).toEqual([])
})
