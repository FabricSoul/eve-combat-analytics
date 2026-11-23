import { expect, it } from 'vitest'
import { loadUiFixture } from '@/app/test/ui-fixture'
import { timelineData, zoomDomain } from './model'

it('clamps the zoom domain to the full fight and a five-second minimum', () => {
  const full = [10_000, 110_000] as const
  const zoomed = zoomDomain(full, full, 0.25, 0.5)
  expect(zoomed).toEqual([22_500, 72_500])
  expect(zoomDomain(full, zoomed, 0.5, 10)).toEqual(full)
  expect(zoomDomain(full, full, 0, 0.001)).toEqual([10_000, 15_000])
  expect(zoomDomain(full, full, 1, 0.001)).toEqual([105_000, 110_000])
})

it('centers damage smoothing and averages only available buckets at either edge', () => {
  const { summary, analysis } = loadUiFixture()
  // Synthetic bucket values with damage at the opening, middle, and closing.
  const timeline = { ...analysis.timeline, damageBySide: { 0: [60, 0, 0, 0, 0, 0, 110, 0, 0, 0, 0, 0, 120] } }
  const { damage } = timelineData(summary, { ...analysis, timeline }, 0)
  const curve = damage.get(0)!
  expect([curve[0], curve[1], curve[6], curve[11], curve[12]]).toEqual([10, 170 / 7, 10, 230 / 7, 20])
})
