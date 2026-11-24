import { describe, expect, it } from 'vitest'
import { entity, stats, tinyAnalysis } from '../battle/roster/testing'
import { foldIdentities } from './merge-view'

const hidden = entity(0, 0, { key: 'name:Hidden', name: 'Hidden', charId: null, shipTypes: ['Rifter'] })
const base = {
  ...tinyAnalysis,
  entities: { ...tinyAnalysis.entities, [hidden.key]: hidden },
  stats: [...tinyAnalysis.stats, { ...stats(0, 70), key: 'name:Hidden' as const }],
  interactions: [{ t: 1, from: 'name:Hidden' as const, to: 'char:4' as const, kind: 'damage' as const, amount: 70, weapon: null, quality: null, repairType: null, ewar: null, sources: [], corroborated: false }],
}

describe('foldIdentities', () => {
  it('moves the unidentified entity onto the character: entity, interactions, stats', () => {
    const folded = foldIdentities(base, [{ from: 'name:Hidden', to: 'char:2' }])
    expect(folded.entities['name:Hidden']).toBeUndefined()
    expect(folded.entities['char:2']?.shipTypes).toEqual(['Leshak', 'Rifter'])
    expect(folded.interactions[0]!.from).toBe('char:2')
    expect(folded.stats.find((s) => s.key === 'char:2')?.damageOut).toBe(500 + 70)
    expect(folded.stats.some((s) => s.key === 'name:Hidden')).toBe(false)
  })

  it('leaves the analysis untouched (same object) when the entity is already folded or unknown', () => {
    expect(foldIdentities(tinyAnalysis, [{ from: 'name:Hidden', to: 'char:2' }])).toBe(tinyAnalysis)
    expect(foldIdentities(base, [{ from: 'name:Hidden', to: 'char:99' }])).toBe(base)
  })
})
