import { expect, it } from 'vitest'
import type { Entity, EntityKey, Interaction } from '@/core/contract'
import { itemTypeGroup } from '@/core/data/item-types'
import { loadUiFixture, uiReplayStart } from '../../test/ui-fixture'
import { aggregateHits, hitMetrics, MIN_RANKED_SHOTS, rankPilots } from './analysis'

const pilots = [1, 2, 3, 4, 5, 6].map((charId): Entity => ({
  key: `char:${charId}`, name: `Pilot ${charId}`, charId,
  side: charId <= 2 ? 0 : charId <= 5 ? 1 : 2, hasLog: charId === 1 || charId === 5,
  sideSource: 'br', shipTypes: [],
}))
const entities = Object.fromEntries(pilots.map((entity) => [entity.key, entity])) as Record<EntityKey, Entity>
const uploaders = new Set<EntityKey>(['char:1', 'char:5'])
function shots(from: EntityKey, to: EntityKey, count: number, options: Partial<Interaction> = {}): Interaction[] {
  return Array.from({ length: count }, () => ({
    from, to, t: 1000, kind: 'damage', amount: 100, quality: 'Wrecks',
    repairType: null, ewar: null, weapon: 'Veles Supratidal Entropic Disintegrator', sources: [], corroborated: false,
    ...options,
  }))
}
const events = [
  ...shots('char:1', 'char:3', 12),
  ...shots('char:1', 'char:3', 12, { weapon: ' 暗泽裔潮上熵能分解者** ' }),
  ...shots('char:1', 'char:3', 6, { kind: 'miss', quality: null, amount: 0 }),
  ...shots('char:1', 'char:3', 10, { quality: 'none' }),
  ...shots('char:3', 'char:1', 24, { weapon: 'Imperial Navy Curator' }),
  ...shots('char:3', 'char:1', 6, { kind: 'miss', quality: null, amount: 0, weapon: 'Imperial Navy Curator' }),
  ...shots('char:3', 'char:2', 99),
  ...shots('char:4', 'char:1', 31, { t: 61_000, amount: 3, quality: 'Hits', weapon: 'Caldari Navy Mjolnir Rocket' }),
  ...shots('char:5', 'char:2', 100),
  ...shots('char:6', 'char:1', 29),
]

it('aggregates graded hits, explicit misses, allied and observed enemy shots and per-minute/class totals', () => {
  const data = aggregateHits(entities, events, uploaders, 0)
  expect(data.sides.get(0)).toMatchObject({ shots: 30, hits: 24, damage: 2400, misses: 6, hitQuality: { Wrecks: 24 } })
  expect(data.sides.get(1)).toMatchObject({ shots: 61, hits: 55, damage: 2493, misses: 6 })
  expect(data.sides.get(2)?.shots).toBe(29)
  expect(data.pilots.get('char:3')?.shots).toBe(30)
  expect(data.pilots.get('char:5')?.shots).toBe(0)
  expect(data.pilots.get('char:1')?.classes.get('turret')?.shots).toBe(30)
  expect(data.pilots.get('char:3')?.classes.get('drone')?.shots).toBe(30)
  expect(data.sides.get(1)?.classes.get('missile')?.shots).toBe(31)
  expect([...data.sides.get(1)!.minutes].map(([time, value]) => [time, value.shots])).toEqual([[0, 30], [60_000, 31]])
})

it('gives tied values the same competition rank, skips low samples and orders miss rate low first', () => {
  const data = aggregateHits(entities, events, uploaders, 0)
  expect(MIN_RANKED_SHOTS).toBe(30)
  const avg = rankPilots(data.pilots.values(), 'damagePerShot')
  expect(avg.ranked.map(({ rank, pilot }) => [rank, pilot.entity.key])).toEqual([[1, 'char:1'], [1, 'char:3'], [3, 'char:4']])
  expect(avg.insufficient.find(({ entity }) => entity.key === 'char:6')?.shots).toBe(29)
  expect(rankPilots(data.pilots.values(), 'missRate').ranked[0]?.pilot.entity.key).toBe('char:4')
  expect(hitMetrics.strongShare.value(data.pilots.get('char:1')!)).toBe(.8)
})

it('uses inclusive range bounds and recomputes sample eligibility', () => {
  const data = aggregateHits(entities, events, uploaders, 0, [61_000, 61_000])
  expect(data.pilots.get('char:1')?.shots).toBe(0)
  expect(data.sides.get(1)?.shots).toBe(31)
  expect(rankPilots(data.pilots.values(), 'hitRate').ranked.map(({ pilot }) => pilot.entity.key)).toEqual(['char:4'])
})

it('finds shots on both sides of J125990 and reconciles checked samples with raw uploader counters', async () => {
  const { statsForRange } = await import('@/core/analysis/range')
  const { analysis, summary } = loadUiFixture()
  const range = [uiReplayStart, uiReplayStart + 60_000] as const
  const data = aggregateHits(analysis.entities, analysis.interactions, new Set(summary.logs.map(({ charId }): EntityKey => `char:${charId}`)), 1, range)
  expect(data.sides.get(0)?.shots).toBeGreaterThan(0)
  expect(data.sides.get(1)?.shots).toBeGreaterThan(0)
  const rangeStats = statsForRange(analysis, summary.meta.killmails, ...range)
  for (const key of ['char:2121605780', 'char:2117427381'] as const) {
    const counts = rangeStats.find((pilot) => pilot.key === key)!
    const { none, ...graded } = counts.hitQuality
    const excluded = analysis.interactions.filter(({ from, t, kind, weapon, quality }) => {
      if (from !== key || t < range[0] || t > range[1] || kind !== 'damage' || !weapon || quality !== 'Hits') return false
      const group = itemTypeGroup(weapon)?.groupId
      return group === 72 || group === 4807
    }).length
    if (excluded) graded.Hits = (graded.Hits ?? 0) - excluded
    expect(data.pilots.get(key)).toMatchObject({ hitQuality: graded, misses: counts.misses, ungraded: (none ?? 0) + excluded })
  }
})

it('keeps ungraded damage and generic smartbomb and breacher Hits out of rate, rank and distribution', () => {
  const data = aggregateHits(entities, [
    ...shots('char:1', 'char:3', 3),
    ...shots('char:1', 'char:3', 1, { kind: 'miss', amount: 0, quality: null }),
    ...shots('char:1', 'char:3', 4, { weapon: 'Uncatalogued effect', quality: 'none' }),
    ...shots('char:2', 'char:3', 35, { weapon: 'Federation Navy Large Plasma Smartbomb', quality: 'Hits' }),
    ...shots('char:2', 'char:3', 1, { weapon: 'Federation Navy Large Plasma Smartbomb', quality: 'none' }),
    ...shots('char:3', 'char:1', 74, { weapon: 'Medium Breacher Pod Launcher', quality: 'Hits' }),
  ], uploaders, 0)
  const ours = data.sides.get(0)!
  expect(hitMetrics.hitRate.value(ours)).toBe(.75)
  expect(ours).toMatchObject({ shots: 4, ungraded: 40, hitQuality: { Wrecks: 3 }, misses: 1 })
  expect(ours.hitQuality.Hits).toBeUndefined()
  expect(ours.minutes.get(0)?.shots).toBe(4)
  const smartbombPilot = data.pilots.get('char:2')!
  expect(smartbombPilot).toMatchObject({ shots: 0, ungraded: 36 })
  expect(hitMetrics.hitRate.value(smartbombPilot)).toBeNull()
  expect(rankPilots(data.pilots.values(), 'hitRate').ranked).toHaveLength(0)
  expect(smartbombPilot.classes.get('smartbomb')).toMatchObject({ shots: 0, ungraded: 36 })
  expect(data.sides.get(1)?.classes.get('missile')).toMatchObject({ shots: 0, ungraded: 74 })
  expect(data.sides.get(1)?.minutes.size).toBe(0)
})
