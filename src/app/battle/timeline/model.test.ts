import { expect, it } from 'vitest'
import { zoomDomain } from './model'

it('clamps the zoom domain to the full fight and a five-second minimum', () => {
  const full = [10_000, 110_000] as const
  const zoomed = zoomDomain(full, full, 0.25, 0.5)
  expect(zoomed).toEqual([22_500, 72_500])
  expect(zoomDomain(full, zoomed, 0.5, 10)).toEqual(full)
  expect(zoomDomain(full, full, 0, 0.001)).toEqual([10_000, 15_000])
  expect(zoomDomain(full, full, 1, 0.001)).toEqual([105_000, 110_000])
})
