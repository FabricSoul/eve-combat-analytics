import { expect, it } from 'vitest'
import { realBattleState } from '../../../fixtures/real/j125990-20250622/load'
import type { Analysis, Entity, Interaction, Killmail } from '../contract'
import { analyze } from './analyze'
import { statsForRange } from './range'

it('matches every whole-fight stat on the real J125990 fixture exactly', () => {
  const state = realBattleState()
  const analysis = analyze(state)
  const { start, end } = state.meta.windows[0]!
  expect(statsForRange(analysis, state.meta.killmails, start, end)).toEqual(analysis.stats)
})

it('counts inclusive events and killmails, clips spans, and leaves the source analysis intact', () => {
  // Synthetic interactions and killmails with hand-checked totals.
  const pilot = (id: number, side: number, hasLog = true): Entity => ({
    key: `char:${id}`, name: String(id), charId: id, side, sideSource: 'br', shipTypes: [], hasLog,
  })
  const a = pilot(1, 0)
  const b = pilot(2, 1)
  const c = pilot(3, 0)
  const d = pilot(4, 1, false)
  const hit = (t: number, amount: number, from = a): Interaction => ({
    t, from: from.key, to: b.key, kind: 'damage', amount, quality: 'Hits',
    weapon: null, repairType: null, ewar: null, sources: [], corroborated: false,
  })
  const analysis: Analysis = {
    entities: { [a.key]: a, [b.key]: b, [c.key]: c, [d.key]: d },
    interactions: [hit(999, 80), hit(1000, 10, c), hit(2000, 20), hit(3000, 30), hit(3001, 40)],
    primaries: [{ target: b.key, bySide: 0, start: 999, end: 2000, killedAt: null, shooters: [a.key, c.key], damage: 110 }],
    ewarSpans: [{ from: a.key, to: b.key, ewar: 'warp_disrupt', start: 500, end: 3500 }],
    stats: [], coverage: [], sideOverrides: [], timeline: { start: 0, damageBySide: { 0: [], 1: [] } },
  }
  const participant = (charId: number, damage: number) => ({
    charId, damage, allyId: null, corpId: null, shipTypeId: null, weaponTypeId: null,
  })
  const mail = (id: number, t: number, damage: number, victim = b): Killmail => ({
    id, t, hash: '', systemId: 1, value: 0,
    victim: participant(victim.charId!, damage),
    attackers: [participant(a.charId!, damage)],
  })

  const stats = statsForRange(analysis, [mail(1, 999, 80, d), mail(2, 3000, 30), mail(3, 3001, 40)], 1000, 3000)
  expect(stats).toHaveLength(3)
  expect(stats[0]).toEqual({
    key: a.key, damageOut: 50, damageIn: 0, repairOut: 0, repairIn: 0, neutOut: 0, neutIn: 0,
    activeRatio: 1, primaryShare: 0.4, firstShotDelay: 1, switchDelayMedian: null, switchAfterKillMedian: null,
    repReactionMedian: null, hitQuality: { Hits: 2 }, misses: 0, pointSeconds: 2, killmailDamage: 30, killmailCount: 1,
  })
  expect(stats[1]).toMatchObject({ key: b.key, damageIn: 60, killmailCount: 1, killmailDamage: 0 })
  expect(stats[2]).toMatchObject({ key: c.key, damageOut: 10, primaryShare: 1 })
  expect(analysis.primaries[0]).toMatchObject({ start: 999, damage: 110, shooters: [a.key, c.key] })
})
