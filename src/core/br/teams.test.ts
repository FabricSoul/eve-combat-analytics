import { describe, expect, it } from 'vitest'
import type { Killmail, KillmailParticipant } from '../contract'
import { inferTeams } from './teams'

const P = (ally: number | null, corp: number | null, char: number | null): KillmailParticipant => ({
  charId: char, corpId: corp, allyId: ally, shipTypeId: 1, weaponTypeId: null, damage: 0,
})
let nextId = 1
const km = (victim: KillmailParticipant, attackers: KillmailParticipant[]): Killmail => ({
  id: nextId++, hash: 'h', systemId: 1, t: nextId * 1000, value: 0, victim, attackers,
})

describe('inferTeams', () => {
  it('splits two alliances that shoot each other', () => {
    const k = [
      km(P(1, 10, 100), [P(2, 20, 200), P(2, 20, 201)]),
      km(P(2, 20, 200), [P(1, 10, 100), P(1, 11, 101)]),
    ]
    const teams = inferTeams(k)
    expect(teams).toHaveLength(2)
    const side = (m: string) => teams.findIndex((t) => t.includes(m as never))
    expect(side('ally:1')).not.toBe(side('ally:2'))
    expect(side('ally:1')).toBeGreaterThanOrEqual(0)
  })

  it('uses the corp when there is no alliance, and ignores participants with neither', () => {
    const k = [km(P(null, 50, 1), [P(null, 60, 2), P(null, null, null)])]
    const teams = inferTeams(k)
    expect(teams.flat().sort()).toEqual(['corp:50', 'corp:60'])
  })

  it('side 0 is the side with more pilots', () => {
    const k = [
      km(P(1, 10, 1), [P(2, 20, 11), P(2, 20, 12), P(2, 20, 13)]),
      km(P(1, 10, 2), [P(2, 20, 11), P(2, 20, 12)]),
    ]
    const teams = inferTeams(k)
    expect(teams[0]).toContain('ally:2')
    expect(teams[1]).toContain('ally:1')
  })

  it('is deterministic and independent of killmail order', () => {
    const k = [
      km(P(1, 10, 1), [P(2, 20, 11), P(3, 30, 12)]),
      km(P(2, 20, 11), [P(1, 10, 1), P(4, 40, 2)]),
      km(P(3, 30, 12), [P(1, 10, 1)]),
      km(P(4, 40, 2), [P(2, 20, 11)]),
    ]
    const a = inferTeams(k)
    expect(inferTeams(k)).toEqual(a)
    expect(inferTeams([...k].reverse())).toEqual(a)
  })

  it('puts a victim-only node (no attackers) on side 1 and keeps it in teams', () => {
    const k = [km(P(1, 10, 1), [P(2, 20, 11), P(2, 20, 12), P(2, 20, 13)]), km(P(7, 70, 5), [])]
    const teams = inferTeams(k)
    expect(teams[1]).toContain('ally:7')
  })

  it('sends a node with tied pulls to the side it co-occurs with most', () => {
    // 3 is shot by both sides once each (tie) but fights alongside 1 twice as the second attacker.
    const k = [
      km(P(9, 90, 90), [P(1, 10, 1), P(3, 30, 3)]),
      km(P(9, 90, 91), [P(1, 10, 1), P(3, 30, 3)]),
      km(P(1, 10, 1), [P(9, 90, 90)]),
      km(P(1, 10, 2), [P(9, 90, 91)]),
    ]
    const teams = inferTeams(k)
    const side = (m: string) => teams.findIndex((t) => t.includes(m as never))
    expect(side('ally:3')).toBe(side('ally:1'))
  })

  it('friendly fire inside one node adds no opposition', () => {
    const k = [km(P(1, 10, 1), [P(1, 10, 2)])]
    expect(() => inferTeams(k)).not.toThrow()
    expect(inferTeams(k).flat()).toEqual(['ally:1'])
  })

  it('returns two empty sides for no killmails', () => {
    expect(inferTeams([])).toEqual([[], []])
  })

  it('a three-way where one alliance fights both still yields two sides', () => {
    const k = [
      km(P(1, 10, 1), [P(2, 20, 2), P(3, 30, 3)]),
      km(P(2, 20, 2), [P(1, 10, 1)]),
      km(P(3, 30, 3), [P(1, 10, 1)]),
    ]
    const teams = inferTeams(k)
    expect(teams).toHaveLength(2)
    const side = (m: string) => teams.findIndex((t) => t.includes(m as never))
    expect(side('ally:2')).toBe(side('ally:3'))
    expect(side('ally:1')).not.toBe(side('ally:2'))
  })
})
