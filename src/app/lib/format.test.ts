import { describe, expect, it } from 'vitest'
import { fmtIsk } from './format'

describe('fmtIsk', () => {
  it('uses 亿 from one hundred million up', () => {
    expect(fmtIsk(1_680_000_000)).toBe('16.8 亿')
    expect(fmtIsk(141_400_000_000, 0)).toBe('1,414 亿')
  })
  it('uses 万 below one hundred million instead of printing 0.0 亿', () => {
    expect(fmtIsk(40_000_000)).toBe('4,000 万')
    expect(fmtIsk(12_345)).toBe('1 万')
  })
  it('prints plain ISK below ten thousand, and a dash for missing values', () => {
    expect(fmtIsk(9_000)).toBe('9,000 ISK')
    expect(fmtIsk(0)).toBe('0 ISK')
    expect(fmtIsk(null)).toBe('—')
  })
})
