import { describe, expect, it } from 'vitest'
import { ifMatchAccepts } from './http'

describe('If-Match comparison for our own revision tokens', () => {
  it('accepts the tag as issued, in a list, and weakened by a proxy', () => {
    // Cloudflare turns ETag: "x" into W/"x" when it compresses a response, and clients echo what they got.
    expect(ifMatchAccepts('"abc"', '"abc"')).toBe(true)
    expect(ifMatchAccepts('W/"abc"', '"abc"')).toBe(true)
    expect(ifMatchAccepts('"zzz", W/"abc"', '"abc"')).toBe(true)
    expect(ifMatchAccepts(' w/"abc" ', '"abc"')).toBe(true)
  })

  it('rejects other tags and a missing current tag', () => {
    expect(ifMatchAccepts('"abd"', '"abc"')).toBe(false)
    expect(ifMatchAccepts('W/"abd"', '"abc"')).toBe(false)
    expect(ifMatchAccepts('"abc"', null)).toBe(false)
    expect(ifMatchAccepts('', '"abc"')).toBe(false)
  })
})
