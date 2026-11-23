import { describe, expect, it } from 'vitest'
import type { Analysis, BattleSummary, Interaction } from '@/core/contract'
import { loadUiFixture, uiReplayStart } from '../../test/ui-fixture'
import { fmtHms } from '../../lib/format'
import { buildFeed, defaultFeedKinds, scopeLabel } from './model'

const T = 1_000_000
function hit(t: number, from: string, to: string, patch: Partial<Interaction> = {}): Interaction {
  return {
    t, from: `char:${from}` as Interaction['from'], to: `char:${to}` as Interaction['to'], kind: 'damage', amount: 100,
    weapon: 'Heavy Missile', quality: null, repairType: null, ewar: null, sources: [], corroborated: false, ...patch,
  }
}
const empty: Analysis = {
  entities: {}, sideOverrides: [], interactions: [], ewarSpans: [], primaries: [], stats: [], coverage: [],
  timeline: { start: T, damageBySide: {} },
}
const summary = (killmails: BattleSummary['meta']['killmails'] = []): BattleSummary => ({
  meta: { brId: 'x', source: 'br.evetools', fetchedAt: 0, windows: [], teams: [[], []], killmails, names: {} },
  logs: [], fits: [], names: {}, sideOverrides: [], analysisVersion: 1,
})

describe('merged feed', () => {
  const interactions = [
    hit(T - 20_000, '1', '2'), // before the window
    hit(T - 9_000, '1', '2'), hit(T - 5_000, '1', '2', { amount: 250 }), hit(T - 1_000, '1', '2'),
    hit(T - 4_000, '3', '2'), hit(T - 3_000, '1', '2', { kind: 'repair', repairType: 'armor', amount: 40 }),
    hit(T + 2_000, '1', '2'), // after t
  ]
  const analysis = { ...empty, interactions }

  it('groups the 10 s ending at t by who, whom and kind: last time, count and total', () => {
    const rows = buildFeed({ analysis, summary: summary(), mode: 'merged', t: T, oursSide: 0 })
    const first = rows.find((r) => r.kind === 'damage' && r.from === 'char:1')
    expect(first).toMatchObject({ lastT: T - 1_000, count: 3, total: 450 })
    expect(rows.filter((r) => r.from === 'char:3')).toHaveLength(1)
    expect(rows.some((r) => r.lastT > T || r.lastT <= T - 10_000)).toBe(false)
    expect(rows.find((r) => r.kind === 'repair')).toMatchObject({ count: 1, total: 40 })
  })

  it('sorts newest group first and marks the newest one as current', () => {
    const rows = buildFeed({ analysis, summary: summary(), mode: 'merged', t: T, oursSide: 0 })
    expect(rows.map((r) => r.lastT)).toEqual([T - 1_000, T - 3_000, T - 4_000])
    expect(rows.map((r) => r.current)).toEqual([true, false, false])
  })

  it('follows t: the window moves with playback', () => {
    const rows = buildFeed({ analysis, summary: summary(), mode: 'merged', t: T - 4_500, oursSide: 0 })
    expect(rows.map((r) => [r.count, r.total])).toEqual([[2, 350]])
  })

  it('filters by kind and by focused pilot', () => {
    const only = buildFeed({ analysis, summary: summary(), mode: 'merged', t: T, oursSide: 0, kinds: ['repair'] })
    expect(only.map((r) => r.kind)).toEqual(['repair'])
    const focus = buildFeed({ analysis, summary: summary(), mode: 'merged', t: T, oursSide: 0, focus: 'char:3' })
    expect(focus.map((r) => r.from)).toEqual(['char:3'])
    expect(defaultFeedKinds).toEqual(['damage', 'repair', 'ewar', 'neut'])
  })
})

describe('raw and key feeds', () => {
  it('raw lists single events, newest first, up to 16', () => {
    const interactions = Array.from({ length: 30 }, (_, i) => hit(T - 9_000 + i * 300, '1', '2'))
    const rows = buildFeed({ analysis: { ...empty, interactions }, summary: summary(), mode: 'raw', t: T, oursSide: 0 })
    expect(rows).toHaveLength(16)
    expect(rows[0]).toMatchObject({ count: 1, lastT: T - 9_000 + 29 * 300 })
    expect(rows[0]!.lastT).toBeGreaterThan(rows[1]!.lastT)
  })

  it('key lists killmails, our primary switches and the top 1% hits up to t', () => {
    const interactions = [
      ...Array.from({ length: 99 }, (_, i) => hit(T - 50_000 + i * 100, '1', '2')),
      hit(T - 30_000, '3', '2', { amount: 9_999 }),
    ]
    const analysis: Analysis = {
      ...empty, interactions,
      primaries: [
        { target: 'char:2', bySide: 0, start: T - 40_000, end: T, killedAt: null, damage: 1, shooters: ['char:1', 'char:3'] },
        { target: 'char:1', bySide: 1, start: T - 40_000, end: T, killedAt: null, damage: 1, shooters: [] },
        { target: 'char:9', bySide: 0, start: T + 5_000, end: T + 9_000, killedAt: null, damage: 1, shooters: [] },
      ],
    }
    const kill = { id: 7, hash: 'h', systemId: 1, t: T - 10_000, value: 2e8, victim: { charId: 2, corpId: null, allyId: null, shipTypeId: 587, weaponTypeId: null, damage: 0 }, attackers: [] }
    const rows = buildFeed({ analysis, summary: summary([kill]), mode: 'key', t: T, oursSide: 0 })
    expect(rows.map((r) => [r.type, r.lastT])).toEqual([
      ['kill', T - 10_000], ['big', T - 30_000], ['primary', T - 40_000],
    ])
    expect(rows[0]).toMatchObject({ victim: 'char:2', total: 2e8 })
    expect(rows[2]).toMatchObject({ to: 'char:2', count: 2 })
  })
})

describe('feed on J125990', () => {
  it('compresses a busy 10 s into a short grouped list', () => {
    const { analysis, summary: s } = loadUiFixture()
    const t = uiReplayStart + 92_000
    const raw = buildFeed({ analysis, summary: s, mode: 'raw', t, oursSide: 1 })
    const merged = buildFeed({ analysis, summary: s, mode: 'merged', t, oursSide: 1 })
    expect(merged.length).toBeLessThanOrEqual(16)
    expect(merged.length).toBeGreaterThan(0)
    expect(raw.length).toBeGreaterThan(0)
  })
})

describe('range and focus in every mode', () => {
  const interactions = [
    hit(T - 9_000, '1', '2', { amount: 10 }), hit(T - 7_000, '1', '2', { amount: 11 }), hit(T - 5_000, '3', '2', { amount: 12 }),
    hit(T - 2_000, '3', '2', { amount: 13 }), hit(T - 1_000, '1', '2', { amount: 500 }),
  ]
  const analysis: Analysis = {
    ...empty, interactions,
    primaries: [
      { target: 'char:2', bySide: 0, start: T - 8_000, end: T, killedAt: null, damage: 1, shooters: ['char:1'] },
      { target: 'char:9', bySide: 0, start: T - 3_000, end: T, killedAt: null, damage: 1, shooters: ['char:3'] },
    ],
  }
  const kill = (id: number, t: number, victim: number, attacker: number) => ({
    id, hash: 'h', systemId: 1, t, value: 1e8,
    victim: { charId: victim, corpId: null, allyId: null, shipTypeId: 587, weaponTypeId: null, damage: 0 },
    attackers: [{ charId: attacker, corpId: null, allyId: null, shipTypeId: 587, weaponTypeId: null, damage: 1 }],
  })
  const km = summary([kill(1, T - 6_000, 2, 1), kill(2, T - 4_000, 9, 3)])
  const total = (rows: { count: number }[]) => rows.reduce((n, r) => n + r.count, 0)

  it('merged and raw keep only events inside the range', () => {
    const range = [T - 8_000, T - 4_000] as const
    expect(total(buildFeed({ analysis, summary: summary(), mode: 'merged', t: T, oursSide: 0, range }))).toBe(2)
    const raw = buildFeed({ analysis, summary: summary(), mode: 'raw', t: T, oursSide: 0, range })
    expect(raw.map((r) => r.lastT)).toEqual([T - 5_000, T - 7_000])
  })

  it('stops at the cursor inside a range and shows nothing before it', () => {
    const range = [T - 8_000, T - 1_000] as const
    expect(buildFeed({ analysis, summary: summary(), mode: 'raw', t: T - 6_000, oursSide: 0, range }).map((r) => r.lastT)).toEqual([T - 7_000])
    expect(buildFeed({ analysis, summary: summary(), mode: 'raw', t: T - 9_500, oursSide: 0, range })).toEqual([])
  })

  it('key mode keeps only kills, primary switches and hits inside the range', () => {
    const rows = buildFeed({ analysis, summary: km, mode: 'key', t: T, oursSide: 0, range: [T - 7_000, T - 3_500] })
    expect(rows.map((r) => [r.type, r.lastT])).toEqual([['kill', T - 4_000], ['kill', T - 6_000]])
  })

  it('key mode honours 只看他: kills, primary switches and big hits that involve the focused pilot', () => {
    const rows = buildFeed({ analysis, summary: km, mode: 'key', t: T, oursSide: 0, focus: 'char:3' })
    expect(rows.map((r) => [r.type, r.id])).toEqual([['primary', `primary-${T - 3_000}-char:9`], ['kill', 'kill-2']])
    const victim = buildFeed({ analysis, summary: km, mode: 'key', t: T, oursSide: 0, focus: 'char:2' })
    expect(victim.map((r) => r.id)).toContain('kill-1')
    expect(victim.map((r) => r.id)).not.toContain('kill-2')
  })
})

describe('scopeLabel', () => {
  it('says what time span the rows cover in each mode', () => {
    expect(scopeLabel('merged', T, null)).toBe(`${fmtHms(T)} 之前 10 秒`)
    expect(scopeLabel('raw', T, null)).toBe(`${fmtHms(T)} 之前 10 秒`)
    expect(scopeLabel('key', T, null)).toBe(`${fmtHms(T)} 之前的关键事件`)
    expect(scopeLabel('merged', T, [T - 60_000, T - 30_000])).toBe(`${fmtHms(T - 60_000)}–${fmtHms(T - 30_000)} 内 · 最近 10 秒`)
    expect(scopeLabel('key', T, [T - 60_000, T + 30_000])).toBe(`${fmtHms(T - 60_000)}–${fmtHms(T)} 内的关键事件`)
  })
})
