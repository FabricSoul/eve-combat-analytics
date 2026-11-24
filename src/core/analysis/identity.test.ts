import { expect, it } from 'vitest'
import { at, battle, event, hit, kill, log, other, pilot } from '../../../fixtures/states/analysis'
import { analyze } from './analyze'

const cruiser = other(null, 'Cruiser', 'Cruiser', 1001)
const cruiserZh = other(null, '巡洋舰', '巡洋舰', 1001)
const frigate = other(null, 'Frigate', 'Frigate', 1000)
const rookCruiser = other('Rook Pilot', 'Cruiser', 'Rook Pilot (Cruiser)', 1001)
const armor = { kind: 'repair', repairType: 'armor', dir: 'out', amount: 20, module: null } as const
const scramble = { kind: 'ewar_seen', ewar: 'warp_scramble', source: cruiser } as const

it('resolves a ship-only label from one named sighting up to sixty seconds away', () => {
  const state = battle([
    log(1, 'Ace', 0, [hit(0, cruiser, 10), hit(120, cruiser, 11), hit(120.001, cruiser, 12)]),
    log(2, 'Wing', 0, [hit(60, rookCruiser, 13), hit(60, rookCruiser, 14)]),
  ])
  expect(analyze(state).interactions.filter(({ from }) => from === 'char:1').map(({ to }) => to))
    .toEqual(['char:3', 'char:3', 'ship:1001:1'])
})

it('requires a ship sighting from a different log or a killmail', () => {
  const state = battle([log(1, 'Ace', 0, [hit(0, rookCruiser, 10), hit(1, cruiser, 11)])])
  expect(analyze(state).interactions.map(({ to }) => to)).toEqual(['char:3', 'ship:1001:1'])
})

it('deduplicates repeated evidence by character and keeps a ship entity when two pilots match', () => {
  const state = battle([
    log(1, 'Ace', 0, [hit(1, cruiser, 10), hit(1, rookCruiser, 11)]),
    log(2, 'Wing', 0, [
      hit(0, rookCruiser, 20),
      hit(1, other('Bishop', 'Cruiser', 'Bishop (Cruiser)', 1001), 20),
    ]),
  ])
  const ace = analyze(state).interactions.filter(({ from }) => from === 'char:1')
  expect(ace.map(({ to }) => to)).toEqual(['ship:1001:1', 'char:3'])
})

it('uses other logs to identify a listener’s ship even without a name-index entry for the listener', () => {
  const state = battle([
    log(1, 'Ace', 0, [event(0, cruiser, armor), event(0, cruiser, { ...armor, dir: 'in' })]),
    log(2, 'Wing', 0, []),
    log(3, 'Rook Pilot', 1, [
      hit(0, other('Wing', 'Cruiser', 'Wing (Cruiser)', 1001), 100),
      hit(0, other('Ace', 'Cruiser', 'Ace (Cruiser)', 1001), 100),
    ]),
  ])
  state.names = { ...state.names, Wing: null }
  const { interactions } = analyze(state)
  expect(interactions.filter(({ kind }) => kind === 'repair').map(({ from, to }) => [from, to]))
    .toEqual([['char:1', 'char:2'], ['char:2', 'char:1']])
})

it('uses both killmail roles and the battle-time side when filtering ship candidates', () => {
  const state = battle([
    log(1, 'Ace', 0, [
      hit(0, cruiser, 10), hit(0, cruiser, 11, { dir: 'in' }), event(0, frigate, armor),
    ]),
  ], [
    kill(1, 0, pilot(3, 200, 1001), [pilot(5, 100, 1001), pilot(2, 100, 1000)]),
  ])
  const { interactions } = analyze(state)
  expect(interactions.map(({ from, to }) => [from, to]))
    .toEqual([['char:1', 'char:3'], ['char:3', 'char:1'], ['char:1', 'char:2']])
})

it('groups localized ship-only labels by type and inferred side, with an unknown-side bucket for other events', () => {
  const state = battle([
    log(1, 'Ace', 0, [
      hit(0, cruiser, 1), hit(0, cruiserZh, 2, { dir: 'in' }),
      event(0, cruiser, armor), event(0, cruiserZh, { ...armor, dir: 'in' }),
      event(0, cruiserZh, { kind: 'neut', dir: 'in', amount: 10, module: null }),
      hit(0, other('Unknown Pilot', 'Cruiser', 'Unknown Pilot (Cruiser)', 1001), 3),
      hit(0, other(null, null, 'Rook Pilot'), 4),
    ]),
  ])
  const { entities, interactions } = analyze(state)
  expect(interactions.map(({ from, to }) => [from, to])).toEqual([
    ['char:1', 'ship:1001:1'],
    ['ship:1001:1', 'char:1'],
    ['char:1', 'ship:1001:0'],
    ['ship:1001:0', 'char:1'],
    ['ship:1001:-1', 'char:1'],
    ['char:1', 'name:Unknown Pilot'],
    ['char:1', 'name:Rook Pilot'],
  ])
  expect(entities['ship:1001:1']).toMatchObject({ charId: null, side: 1, shipTypes: ['Cruiser', '巡洋舰'] })
  expect(entities['ship:1001:0']).toMatchObject({ charId: null, side: 0, shipTypes: ['Cruiser', '巡洋舰'] })
})

it('uses unknown-side damage buckets when there is no single opposite side', () => {
  const state = battle([log(1, 'Ace', 0, [hit(0, cruiser, 1)])])
  state.meta.teams.push(['corp:300'])
  expect(analyze(state).interactions[0]?.to).toBe('ship:1001:-1')
})

it('deduplicates third-party ewar across three witness logs and attributes the span to the actor', () => {
  const state = battle([
    log(1, 'Ace', 0, [event(1, 'Rook Pilot', { kind: 'ewar', dir: 'out', ewar: 'warp_scramble' })]),
    log(2, 'Wing', 0, [event(0, frigate, scramble), event(20, frigate, scramble)]),
    log(4, 'Bishop', 1, [event(1, frigate, scramble), event(21, frigate, scramble)]),
    log(5, 'Medic', 0, [event(1, frigate, scramble), event(21, frigate, scramble)]),
  ], [kill(1, 0, pilot(3, 200, 1000), [pilot(1, 100, 1001)])])
  const result = analyze(state)
  expect(result.interactions.map(({ t, from, to, kind, ewar, sources, corroborated }) =>
    ({ t, from, to, kind, ewar, witnesses: sources.length, corroborated }))).toEqual([
    { t: at(0), from: 'char:1', to: 'char:3', kind: 'ewar', ewar: 'warp_scramble', witnesses: 4, corroborated: true },
    { t: at(20), from: 'char:1', to: 'char:3', kind: 'ewar', ewar: 'warp_scramble', witnesses: 3, corroborated: true },
  ])
  expect(result.ewarSpans).toEqual([0, 20].map((start) =>
    ({ from: 'char:1', to: 'char:3', ewar: 'warp_scramble', start: at(start), end: at(start + 5) })))
  expect(result.stats.find(({ key }) => key === 'char:1')?.pointSeconds).toBe(10)
  expect(analyze({ ...state, logs: [...state.logs].reverse() })).toEqual(result)
})

it('matches repeated observed ewar one-to-one per witness', () => {
  const report = (t: number) => event(t, 'Rook Pilot', { ...scramble, source: other('Ace') })
  const state = battle([
    log(2, 'Wing', 0, [report(0), report(0.25)]),
    log(4, 'Bishop', 1, [report(0.5), report(0.75)]),
    log(5, 'Medic', 0, [report(1)]),
  ])
  const { interactions } = analyze(state)
  expect(interactions.map(({ t, sources }) => [t, sources.length])).toEqual([[at(0), 3], [at(0.25), 2]])
})

it('uses the killmail alliance ahead of a corp on an earlier team to fill an unknown side', () => {
  const victim = { ...pilot(3, 100, 1001), allyId: 300 }
  const state = battle([
    log(1, 'Ace', 0, [hit(0, 'Rook Pilot', 100)]),
    log(2, 'Wing', 0, [hit(0, 'Rook Pilot', 100)]),
  ], [kill(1, 5, victim, [])])
  state.meta.teams[1]!.push('ally:300')
  state.names = { ...state.names, 'Rook Pilot': { charId: 3, side: -1 } }
  const result = analyze(state)
  expect(result.entities['char:3']?.side).toBe(1)
  expect(result.coverage[1]?.known).toBe(1)
  expect(result.primaries.map(({ target }) => target)).toEqual(['char:3'])
})

it('keeps different ewar and repair types separate even with the same endpoints and timestamp', () => {
  const state = battle([
    log(1, 'Ace', 0, [
      event(0, 'Rook Pilot', { kind: 'ewar', dir: 'out', ewar: 'warp_scramble' }),
      event(0, 'Rook Pilot', armor),
    ]),
    log(3, 'Rook Pilot', 1, [
      event(0, 'Ace', { kind: 'ewar', dir: 'in', ewar: 'jam' }),
      event(0, 'Ace', { ...armor, dir: 'in', repairType: 'shield' }),
    ]),
  ])
  expect(analyze(state).interactions.map(({ ewar, repairType }) => ewar ?? repairType))
    .toEqual(['warp_scramble', 'armor', 'jam', 'shield'])
})

it('clips qualifying primary windows to the first and last hit, so an instant switch has no delay', () => {
  const fire = () => Array.from({ length: 40 }, (_, t) => hit(t, t < 20 ? 'Rook Pilot' : 'Bishop', 100))
  const result = analyze(battle([log(1, 'Ace', 0, fire()), log(2, 'Wing', 0, fire())]))
  expect(result.primaries.map(({ target, start, end, damage }) => ({ target, start, end, damage }))).toEqual([
    { target: 'char:3', start: at(0), end: at(19), damage: 4000 },
    { target: 'char:4', start: at(20), end: at(39), damage: 4000 },
  ])
  expect(result.stats.find(({ key }) => key === 'char:1')).toMatchObject({ switchDelayMedian: null, primaryShare: 1 })
  expect(result.stats.find(({ key }) => key === 'char:2')).toMatchObject({ switchDelayMedian: 0, primaryShare: 1 })
})

it('counts both endpoint seconds of an engagement', () => {
  const state = battle([log(1, 'Ace', 0, [hit(0.9, 'Rook Pilot', 10), hit(1.1, 'Rook Pilot', 20)])])
  expect(analyze(state).stats[0]?.activeRatio).toBe(1)
})


it('measures the first follower hit against the side’s first hit and omits the leader', () => {
  const state = battle([
    log(1, 'Ace', 0, [
      hit(0, 'Rook Pilot', 100), hit(20, 'Bishop', 100), hit(21, 'Bishop', 100), hit(43, 'Knight', 100), hit(60, 'Rook Pilot', 100),
    ]),
    log(2, 'Wing', 0, [
      hit(0, 'Rook Pilot', 100), hit(24, 'Bishop', 100), hit(40, 'Knight', 100), hit(68, 'Rook Pilot', 100),
    ]),
  ])
  expect(analyze(state).stats.filter(({ source }) => source === 'own').map(({ switchDelayMedian }) => switchDelayMedian)).toEqual([3, 6])
})

it('counts each fingerprint once for a relogged listener and preserves peer corroboration', () => {
  const first = log(1, 'Ace', 0, [hit(0, 'Rook Pilot', 10), hit(0, 'Rook Pilot', 10), hit(0, 'Rook Pilot', 20)])
  const second = { ...log(1, 'Ace', 0, [hit(0, 'Rook Pilot', 10), hit(0, 'Rook Pilot', 21)]), id: 'ace-relog' }
  const peer = log(3, 'Rook Pilot', 1, [hit(0, 'Ace', 10, { dir: 'in' })])
  const state = battle([first, second, peer])
  const result = analyze(state)
  expect(result.interactions.map(({ amount, sources }) => [amount, sources.length])).toEqual([
    [10, 2], [20, 1], [21, 1],
  ])
  expect(result.stats.find(({ key }) => key === 'char:1')?.damageOut).toBe(51)
  expect(analyze({ ...state, logs: [second, first, peer] })).toEqual(result)
})

it('does not corroborate an ewar activation with another file from the same witness', () => {
  const report = (t: number) => event(t, 'Rook Pilot', { ...scramble, source: other('Ace') })
  const state = battle([
    log(2, 'Wing', 0, [report(0)]),
    { ...log(2, 'Wing', 0, [report(0.75)]), id: 'wing-relog' },
  ])
  expect(analyze(state).interactions.map(({ corroborated }) => corroborated)).toEqual([false, false])
})

it('recovers a stored glued hull only when the pilot prefix is already known', () => {
  const actor = 'Raisen Urli Itinen'
  const glued = actor + 'Bhaalgorn'
  const state = battle([log(1, 'Ace', 0, [hit(0, glued, 10), hit(1, 'Other PilotArazu', 20)])])
  state.names = { [actor]: { charId: 7, side: 1 } }
  const analysis = analyze(state)
  expect(analysis.entities['char:7']).toMatchObject({ name: 'Scout', side: 1, shipTypes: ['Bhaalgorn'] })
  expect(analysis.interactions.map(({ to }) => to)).toEqual(['char:7', 'name:Other PilotArazu'])
})
