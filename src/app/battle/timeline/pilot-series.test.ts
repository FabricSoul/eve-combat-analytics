import { expect, it } from 'vitest'
import { analyze } from '@/core/analysis/analyze'
import type { Analysis, Entity, EntityKey, Interaction } from '@/core/contract'
import { realBattleStateWithBr } from '../../../../fixtures/real/j125990-20250622/load'
import { createPilotSeries } from './pilot-series'

// Synthetic inputs for checking bucket math and log provenance.
const ours = 'char:1'
const observed = 'char:2'
const start = 20_000
function entity(key: EntityKey, hasLog: boolean): Entity {
  return { key, hasLog, charId: null, name: key, side: hasLog ? 1 : 0, sideSource: 'br', shipTypes: [] }
}
function hit(offset: number, from: EntityKey, to: EntityKey, amount: number, kind: Interaction['kind'] = 'damage',
  logId = 'ours', repairType: Interaction['repairType'] = null): Interaction {
  return { t: start + offset, from, to, kind, amount, repairType, quality: null, weapon: null, ewar: null,
    sources: [{ logId, line: 1 }], corroborated: false }
}
const analysis: Analysis = {
  entities: { [ours]: entity(ours, true), [observed]: entity(observed, false) },
  timeline: { start, damageBySide: {} }, primaries: [], stats: [], coverage: [], sideOverrides: [], ewarSpans: [],
  interactions: [
    hit(0, ours, observed, 60),
    hit(800, observed, ours, 120),
    hit(1_010, observed, ours, 400, 'damage', 'opponent'),
    hit(2_000, observed, ours, 42, 'repair', 'ours', 'armor'),
    hit(3_000, observed, ours, 999, 'repair', 'ours', 'capacitor'),
    hit(12_000, ours, observed, 120),
  ],
}

it('buckets per pilot, switches damage direction, and smooths using only available seconds', () => {
  const series = createPilotSeries(analysis, new Set(['ours']))
  const keys = [ours, observed] as const
  const dealt = series(keys, 'damageOut')
  expect(dealt.get(ours)?.samples).toHaveLength(13)
  expect([dealt.get(ours)?.samples[0], dealt.get(ours)?.samples[6], dealt.get(ours)?.samples[12]]).toEqual([10, 0, 20])
  expect(dealt.get(observed)?.samples[0]).toBe(20)
  expect(series(keys, 'damageIn').get(ours)?.samples[0]).toBe(520 / 6)
  expect(series(keys, 'damageIn').get(observed)?.samples[12]).toBe(20)
  expect(series(keys, 'repairOut').get(observed)?.samples[0]).toBe(7)
  expect(series([observed], 'damageOut').get(observed)).toBe(dealt.get(observed))
})

it.skipIf(!process.env.PERF)('builds ten full-fight pilot series in under 50 ms', { retry: 2 }, () => {
  const state = realBattleStateWithBr()
  const fight = analyze(state)
  const keys = state.logs.slice(0, 10).map(({ charId }) => `char:${charId}` as const)
  const logIds = new Set(state.logs.map(({ id }) => id))
  const started = performance.now()
  const series = createPilotSeries(fight, logIds)(keys, 'damageOut')
  const elapsed = performance.now() - started
  console.info(`Built ${series.size} pilot series from ${fight.interactions.length} real events in ${elapsed.toFixed(1)} ms`)
  expect(series.size).toBe(10)
  expect(series.get(keys[0]!)?.samples.length).toBeGreaterThan(2_000)
  expect(elapsed).toBeLessThan(50)
})
