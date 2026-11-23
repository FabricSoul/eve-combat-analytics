import { describe, expect, it } from 'vitest'
import { loadUiFixture } from '../../test/ui-fixture'
import { buildSideColumns, manualSubjects } from './sides-model'

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
