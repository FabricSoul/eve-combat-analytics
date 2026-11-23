import { describe, expect, it } from 'vitest'
import composition from '../../../fixtures/br/6b035d82a6d97f0534b7e73b.composition.json'
import names from '../../../fixtures/br/6b035d82a6d97f0534b7e73b.names.json'
import { normalizeBrComposition, sideOf } from './normalize'

const meta = normalizeBrComposition(composition, names as never, 1795400000000)

describe('normalizeBrComposition on the real BR 6b035d82', () => {
  it('keeps the battle id, five windows in ms and numeric security', () => {
    expect(meta.brId).toBe('6b035d82a6d97f0534b7e73b')
    expect(meta.windows).toHaveLength(5)
    const czdj = meta.windows.find((w) => w.systemName === 'CZDJ-1')!
    expect(czdj).toMatchObject({ systemId: 30002953, regionName: 'Deklein', security: -0.9 })
    expect(czdj.start).toBe(1795374000000)
    expect(czdj.end).toBe(1795388400000)
  })
  it('turns teams into ally:/corp: members', () => {
    expect(meta.teams[0]).toEqual(['ally:1042504553', 'ally:99006125', 'ally:99004013'])
    expect(meta.teams[1]).toContain('corp:98108724')
  })
  it('flattens 55 killmails sorted by time with ms timestamps', () => {
    expect(meta.killmails).toHaveLength(55)
    expect(meta.killmails[0]!.t).toBe(1795376068000)
    const ts = meta.killmails.map((k) => k.t)
    expect([...ts].sort((a, b) => a - b)).toEqual(ts)
  })
  it('splits losses by side as the BR does: side 0 lost 10 ships / 1,056,147,146 ISK', () => {
    const lost = [0, 0]
    const count = [0, 0]
    for (const k of meta.killmails) {
      const s = sideOf(k.victim, meta.teams)
      if (s >= 0) {
        lost[s]! += k.value
        count[s]! += 1
      }
    }
    expect(count).toEqual([10, 44])
    expect(lost[0]).toBe(1056147146)
  })
  it('maps 0 ids to null', () => {
    const km = meta.killmails.find((k) => k.id === 140106547)!
    expect(km.attackers[0]!.allyId).toBeNull()
    expect(km.attackers[0]!.corpId).toBe(98740310)
  })
})
