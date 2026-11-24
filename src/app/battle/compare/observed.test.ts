import { describe, expect, it } from 'vitest'
import { entity, stats } from '../roster/testing'
import { metricValue, metrics, missingReason, type CompareRow } from './metrics'

const row = (source: 'own' | 'observed' | undefined, hasLog: boolean): CompareRow => ({
  entity: entity(1, 0, { hasLog }),
  hasObservation: true,
  stats: { ...stats(1, 900), source, damageIn: 40, repairIn: 7, killmailDamage: 5, killmailCount: 1, primaryShare: 0.5, switchDelayMedian: 3, activeRatio: 0.4, repReactionMedian: 2, firstShotDelay: 1 },
})
const get = (r: CompareRow, key: string) => metricValue(r, metrics.find((m) => m.key === key)!)

describe('observed pilots', () => {
  it('show the numbers observed logs produce', () => {
    const r = row('observed', false)
    expect(get(r, 'damageOut')).toBe(900)
    expect(get(r, 'damageIn')).toBe(40)
    expect(get(r, 'repairIn')).toBe(7)
    expect(get(r, 'primaryShare')).toBe(0.5)
    expect(get(r, 'switchDelayMedian')).toBe(3)
  })

  it('keeps zeroes with own or observed coverage and preserves BR-only killmail data', () => {
    const observed = row('observed', false)
    expect(get(observed, 'repairOut')).toBe(0)
    expect(get(row('own', true), 'repairOut')).toBe(0)
    const brOnly = { ...observed, hasObservation: false }
    expect(get(brOnly, 'repairOut')).toBeNull()
    expect(get(brOnly, 'killmailDamage')).toBe(5)
  })

  it('keep — with a reason for metrics that need the pilot\'s own log', () => {
    const r = row('observed', false)
    for (const key of ['activeRatio', 'repReactionMedian', 'firstShotDelay']) {
      expect(get(r, key), key).toBeNull()
      expect(missingReason(r, metrics.find((m) => m.key === key)!), key).toContain('自己的战斗日志')
    }
  })

  it('distinguishes an observed zero damage type from a missing breakdown', () => {
    const r = row('observed', false)
    const metric = metrics.find(({ key }) => key === 'kinetic')!
    expect(metricValue(r, metric)).toBeNull()
    expect.soft(missingReason(r, metric)).toContain('没有可用的承伤记录')
    expect.soft(metricValue({ ...r, damage: { em: 40 } }, metric)).toBe(0)
  })

  it('uses the observed hit sample and explains when it is empty', () => {
    const r = row('observed', false)
    const metric = metrics.find(({ key }) => key === 'hitRate')!
    expect(metricValue(r, metric)).toBeNull()
    expect(missingReason(r, metric)).toContain('没有带命中信息')
    r.observedHits = { hits: 0, shots: 2, misses: 2, ungraded: 0, damage: 0, hitQuality: {} }
    expect(metricValue(r, metric)).toBe(0)
  })

  it('own-log pilots are unchanged and old analyses without source still hide the numbers', () => {
    expect(get(row('own', true), 'activeRatio')).toBe(0.4)
    expect(get(row(undefined, false), 'damageOut')).toBeNull()
  })
})
