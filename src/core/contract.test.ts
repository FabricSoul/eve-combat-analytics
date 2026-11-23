import { describe, expect, it } from 'vitest'
import composition from '../../fixtures/br/6b035d82a6d97f0534b7e73b.composition.json'
import names from '../../fixtures/br/6b035d82a6d97f0534b7e73b.names.json'
import { GamelogFormatError } from './contract'

describe('fixtures', () => {
  it('BR 6b035d82 fixture is the real battle: 5 systems, 55 killmails, 2 teams', () => {
    expect(composition.id).toBe('6b035d82a6d97f0534b7e73b')
    expect(composition.relateds).toHaveLength(5)
    expect(composition.relateds.reduce((n, r) => n + r.kms.length, 0)).toBe(55)
    expect(composition.teams).toHaveLength(2)
  })
  it('names fixture resolves every id', () => {
    expect(Object.keys(names)).toHaveLength(442)
    expect((names as Record<string, { name: string }>)['22456']?.name).toBe('Sabre')
  })
  it('GamelogFormatError carries a code', () => {
    expect(new GamelogFormatError('no_listener', 'x').code).toBe('no_listener')
  })
})
