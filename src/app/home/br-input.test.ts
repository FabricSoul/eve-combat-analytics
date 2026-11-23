import { describe, expect, it } from 'vitest'
import { ApiFailure } from '../api/client'
import { brErrorMessage, validateBrInput } from './br-input'

const id = '6b035d82a6d97f0534b7e73b'

describe('BR link validation', () => {
  it.each([
    [`https://br.evetools.org/br/${id}`, id],
    [`  https://br.evetools.org/br/${id.toUpperCase()}/  `, id],
    [id, id],
    ['https://br.evetools.org/related/31002058/202506221542', 'related-31002058-202506221542'],
    ['https://zkillboard.com/related/31002058/202506221542/', 'related-31002058-202506221542'],
  ])('accepts %s', (input, key) => {
    expect(validateBrInput(input)).toEqual({ ok: true, key })
  })

  it.each([
    '', '   ', 'hello', 'http://br.evetools.org/br/' + id, `https://example.com/br/${id}`,
    'https://br.evetools.org/br/123', 'https://br.evetools.org/related/31002058/202513991542',
  ])('rejects %j in Chinese', (input) => {
    const result = validateBrInput(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.message).toMatch(/[一-鿿]/)
  })

  it('translates API failures', () => {
    for (const code of ['bad_br_url', 'br_not_found', 'br_unavailable', 'network'] as const) {
      expect(brErrorMessage(new ApiFailure(code, 'raw english'))).toMatch(/[一-鿿]/)
      expect(brErrorMessage(new ApiFailure(code, 'raw english'))).not.toContain('raw english')
    }
    expect(brErrorMessage(new Error('x'))).toMatch(/[一-鿿]/)
  })
})
