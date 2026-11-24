import { describe, expect, it } from 'vitest'
import type { Analysis, BattleSummary, Entity } from '@/core/contract'
import { loadUiFixture } from '../test/ui-fixture'
import { defaultOursSide, sideName } from './sides'

const { summary, analysis } = loadUiFixture()

describe('defaultOursSide', () => {
  it('chooses the new third side after all uploaders in a two-side room move there', () => {
    expect(summary.meta.teams).toHaveLength(2)
    const sideOverrides = [...new Set(summary.logs.map(({ charId }) => charId))].map((charId): BattleSummary['sideOverrides'][number] =>
      ({ subject: `char:${charId}`, side: 2, source: 'manual', setAt: 1 }))
    expect(defaultOursSide({ ...summary, sideOverrides })).toBe(2)
  })

  it('uses the lower side index when distinct uploader counts tie', () => {
    const [first, second] = summary.logs
    expect(defaultOursSide({ ...summary, sideOverrides: [], logs: [
      { ...first!, side: 1 },
      { ...first!, id: 'second-file', side: 1 },
      { ...second!, side: 0 },
    ] })).toBe(0)
  })
})

describe('sideName', () => {
  it('names the real J125990 sides by their largest affiliation and counts distinct identified pilots', () => {
    expect(sideName(0, summary, analysis)).toBe('No Vacancies. 等 63 人')
    expect(sideName(1, summary, analysis)).toBe('DeltaForce.inc 等 43 人')
  })

  it('uses analysis membership after an override and can name a pilot with only an indexed affiliation', () => {
    // Synthetic sides and identity keys for side-edit behavior regardless of the BR's original teams.
    const moved: Entity = {
      key: 'char:101', name: 'Moved Pilot', charId: 101, side: 2, sideSource: 'manual', shipTypes: [], hasLog: true,
    }
    const sameCorp: Entity = { ...moved, key: 'char:102', name: 'Other Pilot', charId: 102 }
    const ship: Entity = {
      ...moved, key: 'ship:11393:2', name: 'Ship only', charId: null, sideSource: 'unknown',
    }
    const customSummary: BattleSummary = {
      ...summary,
      meta: { ...summary.meta, names: { ...summary.meta.names, 103: { name: 'Local Corp', category: 'corporation' } } },
      names: {
        'Moved Pilot': { charId: 101, side: 0, corpId: 103, allyId: null },
        'Other Pilot': { charId: 102, side: 1, corpId: 103, allyId: null },
      },
    }
    const customAnalysis: Analysis = {
      ...analysis, entities: { [moved.key]: moved, [sameCorp.key]: sameCorp, [ship.key]: ship },
    }
    expect(sideName(2, customSummary, customAnalysis)).toBe('Local Corp 等 2 人')
  })

  it('labels unassigned pilots and uses a named BR faction when a side has no identified pilot', () => {
    const empty = { ...analysis, entities: {} }
    expect(sideName(-1, summary, analysis)).toBe('未分边')
    const firstTeamMember = summary.meta.teams[0]![0]!
    const brName = summary.meta.names[Number(firstTeamMember.split(':')[1])]?.name
    expect(brName).toBeTruthy()
    expect(sideName(0, summary, empty)).toBe(brName)
    expect(sideName(5, summary, empty)).toBe('第 6 方')
  })
})
