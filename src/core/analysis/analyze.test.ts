import { describe, expect, it } from 'vitest'
import composition from '../../../fixtures/br/6b035d82a6d97f0534b7e73b.composition.json'
import names from '../../../fixtures/br/6b035d82a6d97f0534b7e73b.names.json'
import {
  at,
  battle,
  event,
  exchange,
  hit,
  log,
  pilotComparison,
  primaryGaps,
  primaryThreshold,
} from '../../../fixtures/states/analysis'
import { normalizeBrComposition, sideOf } from '../br/normalize'
import { analyze } from './analyze'

describe('analyze', () => {
  it('matches bursts one-to-one in time order, including null weapons and misses', () => {
    const state = exchange()
    const [ace, rook] = state.logs
    const { interactions, entities, coverage, timeline } = analyze(state)
    const source = (logId: string, line: number) => ({ logId, line })
    expect(interactions.map(({ t, from, to, kind, amount, weapon, sources, corroborated }) => (
      { t, from, to, kind, amount, weapon, sources, corroborated }
    ))).toEqual([
      {
        t: at(0.25), from: 'char:1', to: 'char:3', kind: 'damage', amount: 100, weapon: 'Railgun',
        sources: [source(ace!.id, 1), source(rook!.id, 1)], corroborated: true,
      },
      {
        t: at(0.25), from: 'char:1', to: 'char:3', kind: 'damage', amount: 100, weapon: 'Railgun',
        sources: [source(ace!.id, 2), source(rook!.id, 2)], corroborated: true,
      },
      {
        t: at(0.25), from: 'char:1', to: 'char:3', kind: 'damage', amount: 100, weapon: 'Cannon',
        sources: [source(ace!.id, 3)], corroborated: false,
      },
      {
        t: at(1.25), from: 'char:1', to: 'char:3', kind: 'miss', amount: 0, weapon: 'Laser',
        sources: [source(ace!.id, 4), source(rook!.id, 3)], corroborated: true,
      },
      {
        t: at(2), from: 'name:Automated Sentry', to: 'char:1', kind: 'damage', amount: 45, weapon: 'Laser',
        sources: [source(ace!.id, 5)], corroborated: false,
      },
      {
        t: at(6), from: 'char:1', to: 'char:3', kind: 'damage', amount: 50, weapon: 'Laser',
        sources: [source(ace!.id, 6)], corroborated: false,
      },
      {
        t: at(7.001), from: 'char:1', to: 'char:3', kind: 'damage', amount: 50, weapon: 'Laser',
        sources: [source(rook!.id, 4)], corroborated: false,
      },
    ])
    expect(interactions[0]?.quality).toBe('Smashes')
    expect(entities).toEqual({
      'char:1': { key: 'char:1', name: 'Ace', charId: 1, side: 0, shipTypes: ['Cruiser'], hasLog: true },
      'char:3': { key: 'char:3', name: 'Rook', charId: 3, side: 1, shipTypes: ['Cruiser', 'Frigate'], hasLog: true },
      'char:7': { key: 'char:7', name: 'Scout', charId: 7, side: 0, shipTypes: ['Frigate'], hasLog: false },
      'name:Automated Sentry': {
        key: 'name:Automated Sentry', name: 'Automated Sentry', charId: null, side: -1,
        shipTypes: ['Sentry Gun'], hasLog: false,
      },
    })
    expect(coverage).toEqual([{ side: 0, known: 2, withLog: 1 }, { side: 1, known: 1, withLog: 1 }])
    expect(timeline).toEqual({
      start: at(0),
      damageBySide: { 0: [300, 0, 0, 0, 0, 0, 50, 50], 1: Array<number>(8).fill(0) },
    })
  })

  it('matches equal reports only if the weapons are compatible and the source files differ', () => {
    const state = battle([
      log(1, 'Ace', 0, [hit(0, 'Rook', 10), hit(0, 'Rook', 10), hit(2, 'Rook', 20, { weapon: 'Railgun' })]),
      log(3, 'Rook', 1, [hit(2, 'Ace', 20, { dir: 'in', weapon: 'Cannon' })]),
    ])
    expect(analyze(state).interactions.map(({ corroborated }) => corroborated)).toEqual([false, false, false, false])
  })

  it('merges repeating ewar per source, recipient and type, splitting at exactly 15 seconds', () => {
    expect(analyze(pilotComparison()).ewarSpans).toEqual([
      { from: 'char:1', to: 'char:3', ewar: 'warp_scramble', start: at(8), end: at(27) },
      { from: 'char:1', to: 'char:3', ewar: 'web', start: at(9), end: at(14) },
      { from: 'char:1', to: 'char:3', ewar: 'warp_disrupt', start: at(23), end: at(28) },
      { from: 'char:1', to: 'char:3', ewar: 'warp_scramble', start: at(37), end: at(42) },
    ])
  })

  it('requires at least 40% of outgoing damage and two shooters for a primary', () => {
    expect(analyze(primaryThreshold(39, true)).primaries).toEqual([])
    expect(analyze(primaryThreshold(40, false)).primaries).toEqual([])
    expect(analyze(primaryThreshold(40, true)).primaries).toEqual([
      { bySide: 0, start: at(0), end: at(0), target: 'char:3', killedAt: null, damage: 40, shooters: ['char:1', 'char:2'] },
    ])
  })

  it('bridges gaps of fewer than five seconds and matches kills through span end plus ten seconds', () => {
    const state = primaryGaps()
    expect(analyze(state).primaries).toEqual([
      {
        bySide: 0, start: at(0), end: at(25), target: 'char:3', killedAt: at(35),
        damage: 450, shooters: ['char:1', 'char:2'],
      },
      {
        bySide: 0, start: at(40), end: at(40), target: 'char:3', killedAt: null,
        damage: 150, shooters: ['char:1', 'char:2'],
      },
    ])
    state.meta.killmails.shift()
    expect(analyze(state).primaries.map(({ killedAt }) => killedAt)).toEqual([null, null])
  })

  it('computes every comparison field and includes killmail participants without logs', () => {
    const analysis = analyze(pilotComparison())
    expect(analysis.stats.find(({ key }) => key === 'char:1')).toEqual({
      key: 'char:1', activeRatio: 4 / 43, damageOut: 190, damageIn: 100, repairOut: 75, repairIn: 30, neutOut: 8,
      neutIn: 9, primaryShare: 180 / 190, switchDelayMedian: null, repReactionMedian: 16, firstShotDelay: 0,
      hitQuality: { Hits: 2, Smashes: 1, none: 1 }, misses: 1, pointSeconds: 29, killmailDamage: 540, killmailCount: 2,
    })
    expect(analysis.stats.find(({ key }) => key === 'char:2')).toMatchObject({
      activeRatio: 2 / 20, firstShotDelay: 1, primaryShare: 1, switchDelayMedian: 0, repReactionMedian: null,
    })
    expect(analysis.stats.find(({ key }) => key === 'char:5')).toEqual({
      key: 'char:5', activeRatio: 0, damageOut: 0, damageIn: 0, repairOut: 0, repairIn: 0, neutOut: 0, neutIn: 0,
      primaryShare: 0, switchDelayMedian: null, repReactionMedian: null, firstShotDelay: null, hitQuality: {},
      misses: 0, pointSeconds: 0, killmailDamage: 70, killmailCount: 1,
    })
    expect(analysis.coverage).toEqual([{ side: 0, known: 3, withLog: 2 }, { side: 1, known: 2, withLog: 1 }])
    expect(analysis.interactions.find(({ kind }) => kind === 'repair')?.repairType).toBe('armor')
    expect(analysis.interactions.find(({ kind }) => kind === 'nos')?.amount).toBe(50)
  })

  it('counts the only engaged second when engagement has no duration and ignores hostile repair for reaction times', () => {
    const state = battle([
      log(1, 'Ace', 0, [
        hit(0, 'Rook', 20),
        event(0, 'Rook', { kind: 'repair', dir: 'out', amount: 15, repairType: 'armor', module: null }),
      ]),
    ])
    expect(analyze(state).stats[0]).toMatchObject({ activeRatio: 1, repReactionMedian: null, repairOut: 15 })
  })

  it('matches the real battle report coverage and Zeikku Targaryen killmail totals with zero logs', () => {
    const meta = normalizeBrComposition(composition, names, 1_795_400_000_000)
    const analysis = analyze({ ...battle([]), meta })
    const known = [new Set<number>(), new Set<number>()]
    for (const killmail of meta.killmails) {
      for (const participant of [killmail.victim, ...killmail.attackers]) {
        if (participant.charId !== null) known[sideOf(participant, meta.teams)]?.add(participant.charId)
      }
    }
    expect(known.map(({ size }) => size)).toEqual([142, 49])
    expect(analysis.coverage).toEqual([{ side: 0, known: 142, withLog: 0 }, { side: 1, known: 49, withLog: 0 }])
    expect(analysis.entities['char:2113179297']?.name).toBe('Zeikku Targaryen')
    expect(analysis.stats.find(({ key }) => key === 'char:2113179297')).toMatchObject({
      killmailDamage: 54_034, killmailCount: 15, damageOut: 0, firstShotDelay: null,
    })
    expect(analysis.timeline).toEqual({ start: 1_795_376_068_000, damageBySide: { 0: [], 1: [] } })
    expect(analyze(battle([])).timeline).toEqual({ start: 0, damageBySide: { 0: [], 1: [] } })
  })

  it('produces the same exact output for repeated analyses and reordered uploads', () => {
    const state = exchange()
    const result = analyze(state)
    expect(analyze(state)).toEqual(result)
    expect(analyze({ ...state, logs: [...state.logs].reverse() })).toEqual(result)
    expect(JSON.stringify(analyze({ ...state, logs: [...state.logs].reverse() }))).toBe(JSON.stringify(result))
  })
})
