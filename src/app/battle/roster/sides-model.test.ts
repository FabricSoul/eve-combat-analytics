import { describe, expect, it } from 'vitest'
import { loadUiFixture } from '../../test/ui-fixture'
import type { BattleSummary } from '@/core/contract'
import { buildRoster } from './model'
import { buildSideColumns, manualSubjects } from './sides-model'
import { tinyAnalysis, tinySummary } from './testing'

describe('buildSideColumns', () => {
  const { summary, analysis } = loadUiFixture()

  it('makes one column per side with ours first and the unassigned pilots in their own group', () => {
    const { columns, unassigned, order } = buildSideColumns(summary, analysis, 1)
    expect(order.slice(0, 2)).toEqual([1, 0])
    expect(columns.map((c) => c.side)).toEqual(order)
    expect(unassigned?.side).toBe(-1)
    expect(unassigned?.pilotCount).toBe(23)
  })

  it('groups pilots under their alliance, or their corporation when they have no alliance', () => {
    const { columns } = buildSideColumns(summary, analysis, 1)
    const groups = columns.flatMap((c) => c.groups)
    expect(groups.every((g) => /^(ally|corp|char):\d+$/.test(g.subject))).toBe(true)
    expect(groups.some((g) => g.subject.startsWith('ally:'))).toBe(true)
    const total = columns.reduce((n, c) => n + c.pilotCount, 0) + 23
    expect(total).toBe(Object.values(analysis.entities).filter((e) => e.charId !== null).length)
    for (const column of columns) {
      expect(column.groups.reduce((n, g) => n + g.pilots.length, 0)).toBe(column.pilotCount)
    }
  })

  it('lists only manual overrides for 恢复 BR 的划分', () => {
    expect(manualSubjects({
      ...summary,
      sideOverrides: [
        { subject: 'corp:1', side: 0, source: 'manual', setAt: 1 },
        { subject: 'char:2', side: 1, source: 'log', setAt: 2 },
        { subject: 'corp:1', side: 1, source: 'manual', setAt: 3 },
      ],
    })).toEqual(['corp:1'])
  })
})

it('uses the matching historical corporation and the newest organization override for the manual hover', () => {
  const first = tinySummary.meta.killmails[0]!
  const pilot = first.attackers.find(({ charId }) => charId === 3)!
  const summary: BattleSummary = {
    ...tinySummary,
    meta: {
      ...tinySummary.meta,
      teams: [['corp:12'], []],
      killmails: [first, { ...first, id: 2, t: 1, attackers: [{ ...pilot, corpId: 12 }] }],
    },
    sideOverrides: [
      { subject: 'corp:11', side: 0, source: 'manual', setAt: Date.UTC(2026, 10, 23, 11, 1) },
      { subject: 'corp:12', side: 0, source: 'manual', setAt: Date.UTC(2026, 10, 23, 12, 5) },
      { subject: 'ally:20', side: 1, source: 'manual', setAt: Date.UTC(2026, 10, 23, 13, 10) },
    ],
  }
  const analysis = {
    ...tinyAnalysis, entities: {
      ...tinyAnalysis.entities, 'char:3': { ...tinyAnalysis.entities['char:3']!, side: 1, sideSource: 'manual' as const },
    },
  }
  const row = buildRoster(summary, analysis, 0).flatMap(({ rows }) => rows).find(({ charId }) => charId === 3)
  expect(row?.tag).toEqual({ kind: 'manual', title: '手动 · 13:10 改' })
  const panel = buildSideColumns(summary, analysis, 0)
  const alliance = panel.columns.find(({ side }) => side === 1)?.groups.find(({ subject }) => subject === 'ally:20')
  expect(alliance?.corporations?.find(({ subject }) => subject === 'corp:12')?.pilots.map(({ charId }) => charId)).toEqual([3])
})
