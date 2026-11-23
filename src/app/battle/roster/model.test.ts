import { describe, expect, it } from 'vitest'
import type { Analysis, BattleSummary, Entity, PilotStats } from '@/core/contract'
import { loadUiFixture } from '../../test/ui-fixture'
import { affiliationOf } from './affiliation'
import { buildRoster, sideName } from './model'

const stats = (id: number, damageOut: number): PilotStats => ({
  key: `char:${id}`, activeRatio: 0, damageOut, damageIn: 0, repairOut: 0, repairIn: 0, neutOut: 0, neutIn: 0,
  primaryShare: 0, switchDelayMedian: null, switchAfterKillMedian: null, repReactionMedian: null, firstShotDelay: null,
  hitQuality: {}, misses: 0, pointSeconds: 0, killmailDamage: 0, killmailCount: 0,
})

function entity(id: number, side: number, patch: Partial<Entity> = {}): Entity {
  return {
    key: `char:${id}`, name: `P${id}`, charId: id, side, sideSource: 'br', shipTypes: ['Leshak'], hasLog: false, ...patch,
  }
}

const base: BattleSummary = {
  meta: {
    brId: 'x', source: 'br.evetools', fetchedAt: 0, windows: [], teams: [[], []], names: {},
    killmails: [{
      id: 1, hash: 'h', systemId: 1, t: 0, value: 1,
      victim: { charId: 4, corpId: 40, allyId: null, shipTypeId: 1, weaponTypeId: null, damage: 0 },
      attackers: [],
    }],
  },
  logs: [], fits: [], names: {}, sideOverrides: [], analysisVersion: 1,
}

function analysisOf(entities: Entity[], patch: Partial<Analysis> = {}): Analysis {
  return {
    entities: Object.fromEntries(entities.map((e) => [e.key, e])),
    sideOverrides: [], interactions: [], ewarSpans: [], primaries: [],
    stats: [stats(1, 10), stats(2, 500), stats(3, 100), stats(5, 900), stats(6, 5), stats(7, 50)],
    coverage: [{ side: 0, known: 3, withLog: 0 }, { side: 1, known: 4, withLog: 1 }],
    timeline: { start: 0, damageBySide: {} },
    ...patch,
  }
}

describe('buildRoster', () => {
  const entities = [
    entity(1, 0, { hasLog: true }), entity(2, 0), entity(3, 0, { hasLog: true }), // ours
    entity(4, 1), entity(5, 1), // theirs; 4 is dead
    entity(6, -1), entity(7, 2),
  ]

  it('puts ours with logs first, then the rest of ours, then other sides by output, and 未分边 last', () => {
    const groups = buildRoster(base, analysisOf(entities), 0)
    expect(groups.map((g) => g.side)).toEqual([0, 1, 2, -1])
    expect(groups[0]?.rows.map((r) => r.charId)).toEqual([3, 1, 2])
    expect(groups.at(-1)?.side).toBe(-1)
    expect(groups.at(-1)?.rows.map((r) => r.charId)).toEqual([6])
  })

  it('orders other sides by population via sideOrder and their rows by damage output', () => {
    const groups = buildRoster(base, analysisOf(entities, {
      coverage: [{ side: 0, known: 3, withLog: 0 }, { side: 1, known: 2, withLog: 0 }, { side: 2, known: 9, withLog: 0 }],
    }), 0)
    expect(groups.map((g) => g.side)).toEqual([0, 2, 1, -1])
    expect(groups[2]?.rows.map((r) => r.charId)).toEqual([5, 4])
  })

  it('marks log dots, dead pilots and ship type ids', () => {
    const rows = buildRoster(base, analysisOf(entities), 0).flatMap((g) => g.rows)
    expect(rows.find((r) => r.charId === 4)?.dead).toBe(true)
    expect(rows.find((r) => r.charId === 5)?.dead).toBe(false)
    expect(rows.find((r) => r.charId === 1)?.hasLog).toBe(true)
    expect(rows.find((r) => r.charId === 1)?.shipTypeId).toBe(47271)
  })

  it('lists ship: and name: entities after the char: rows of their side, with the key\'s ship type and no portrait', () => {
    const extra: Entity[] = [
      { key: 'ship:587:1', name: 'Rifter', charId: null, side: 1, sideSource: 'br', shipTypes: ['Rifter'], hasLog: false },
      { key: 'name:Hidden Pilot', name: 'Hidden Pilot', charId: null, side: 1, sideSource: 'br', shipTypes: ['Leshak'], hasLog: false },
    ]
    const analysis = analysisOf([...entities, ...extra])
    analysis.stats.push({ ...stats(0, 99_999), key: 'ship:587:1' }, { ...stats(0, 1), key: 'name:Hidden Pilot' })
    const side1 = buildRoster(base, analysis, 0).find((g) => g.side === 1)!.rows
    expect(side1.map((r) => r.key)).toEqual(['char:5', 'char:4', 'ship:587:1', 'name:Hidden Pilot'])
    expect(side1[2]).toMatchObject({ charId: null, name: 'Rifter', shipTypeId: 587, hasLog: false, tag: null })
    expect(side1[3]).toMatchObject({ charId: null, name: 'Hidden Pilot', shipTypeId: 47271 })
  })

  it('marks a pilot dead only from the killmail time on (pod loss after a ship loss stays dead)', () => {
    const kill = (id: number, t: number) => ({ ...base.meta.killmails[0]!, id, t })
    const summary: BattleSummary = {
      ...base,
      meta: { ...base.meta, killmails: [kill(1, 1_000), { ...kill(2, 2_000), victim: { ...base.meta.killmails[0]!.victim } }] },
    }
    const deadAt = (at?: number) => buildRoster(summary, analysisOf(entities), 0, at).flatMap((g) => g.rows).find((r) => r.charId === 4)?.dead
    expect(deadAt(999)).toBe(false)
    expect(deadAt(1_000)).toBe(true)
    expect(deadAt(5_000)).toBe(true)
    expect(deadAt()).toBe(true)
  })

  it('tags only changed sides: 据日志 with the reason, 手动 with the change time', () => {
    const summary: BattleSummary = {
      ...base,
      sideOverrides: [{ subject: 'char:2', side: 0, source: 'manual', setAt: Date.UTC(2025, 5, 22, 16, 5, 30) }],
    }
    const analysis = analysisOf([
      entity(1, 0), entity(2, 0, { sideSource: 'manual' }), entity(3, 0, { sideSource: 'log' }),
    ], { sideOverrides: [{ subject: 'char:3', side: 0, source: 'log', reason: 'repaired side 0: 842 events', setAt: 0 }] })
    const rows = buildRoster(summary, analysis, 0)[0]!.rows
    const tag = (id: number) => rows.find((r) => r.charId === id)?.tag
    expect(tag(1)).toBeNull()
    expect(tag(2)).toEqual({ kind: 'manual', title: '手动 · 16:05 改' })
    expect(tag(3)).toEqual({ kind: 'log', title: 'repaired side 0: 842 events' })
  })

  it('finds a pilot\'s corp and alliance from killmails, logs and the name index', () => {
    const summary: BattleSummary = {
      ...base, names: { P9: { charId: 9, side: 0, corpId: 90, allyId: 900 } },
    }
    expect(affiliationOf(summary, 4)).toEqual({ corpId: 40, allyId: null })
    expect(affiliationOf(summary, 9)).toEqual({ corpId: 90, allyId: 900 })
    expect(affiliationOf(summary, 77)).toBeNull()
  })

  it('names sides: 我方, 敌方, then 第 N 方', () => {
    expect([0, 1, 2, 3].map((s) => sideName(s, [0, 1, 2, 3]))).toEqual(['我方', '敌方', '第三方', '第四方'])
    expect(sideName(-1, [0, 1])).toBe('未分边')
  })
})

describe('buildRoster on J125990', () => {
  it('has our logged pilots first and every unassigned pilot in the last group', () => {
    const { summary, analysis } = loadUiFixture()
    const groups = buildRoster(summary, analysis, 1)
    expect(groups[0]?.side).toBe(1)
    const ours = groups[0]!.rows
    const firstUnlogged = ours.findIndex((r) => !r.hasLog)
    expect(ours.slice(0, firstUnlogged).every((r) => r.hasLog)).toBe(true)
    expect(ours.slice(firstUnlogged).some((r) => r.hasLog)).toBe(false)
    expect(groups.at(-1)?.side).toBe(-1)
    expect(groups.at(-1)?.rows.filter((r) => r.charId !== null)).toHaveLength(23)
    expect(groups.at(-1)?.rows.slice(0, 23).every((r) => r.charId !== null)).toBe(true)
  })
})
