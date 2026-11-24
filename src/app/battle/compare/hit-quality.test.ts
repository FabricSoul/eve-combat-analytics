import { expect, it } from 'vitest'
import { loadUiFixture } from '../../test/ui-fixture'
import { metricValue, metrics, missingReason } from './metrics'

it('derives hit rate with reported hits and misses, excluding ungraded damage', () => {
  const { analysis } = loadUiFixture()
  const stats = analysis.stats.find((value) => analysis.entities[value.key]?.name === 'Blanchard2213')!
  const entity = analysis.entities[stats.key]!
  const metric = metrics.find(({ key }) => key === 'hitRate')!
  expect(metric).toBeDefined()
  const row = { entity, hasObservation: true, stats: { ...stats, hitQuality: { Hits: 3, none: 100 }, misses: 1 } }
  expect(metricValue(row, metric)).toBe(.75)
  expect(metricValue({ ...row, stats: { ...row.stats, hitQuality: {}, misses: 3 } }, metric)).toBe(0)
  const noShots = { ...row, stats: { ...row.stats, hitQuality: { none: 100 }, misses: 0 } }
  expect(metricValue(noShots, metric)).toBeNull()
  expect(missingReason(noShots, metric)).toContain('没有带命中信息')
  const noLog = { ...row, entity: { ...entity, hasLog: false } }
  expect(metricValue(noLog, metric)).toBeNull()
  expect(missingReason(noLog, metric)).toBe('没有上传他的战斗日志')
})
