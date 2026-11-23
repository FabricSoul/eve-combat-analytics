import { describe, expect, it } from 'vitest'
import { sideForCharacter } from './side'

const teams = [['ally:1', 'ally:2'], ['corp:50']] as const

describe('sideForCharacter', () => {
  const t = teams.map((x) => [...x]) as never
  it('matches by alliance', () => expect(sideForCharacter({ charId: 1, corpId: 9, allyId: 2 }, t)).toBe(0))
  it('matches by corp', () => expect(sideForCharacter({ charId: 1, corpId: 50, allyId: null }, t)).toBe(1))
  it('-1 when nobody matches', () => expect(sideForCharacter({ charId: 1, corpId: 9, allyId: 3 }, t)).toBe(-1))
})
