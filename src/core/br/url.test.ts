import { describe, expect, it } from 'vitest'
import { parseBrUrl } from './url'

const ID = '6b035d82a6d97f0534b7e73b'

describe('parseBrUrl accepts', () => {
  it.each([
    [`https://br.evetools.org/br/${ID}`],
    [`https://www.br.evetools.org/br/${ID}`],
    [`https://br.evetools.org/br/${ID}/`],
    [`https://br.evetools.org/br/${ID}?tab=teams`],
    [`https://br.evetools.org/br/${ID}#top`],
    [`https://br.evetools.org/br/${ID}/?tab=x#y`],
    [`  https://br.evetools.org/br/${ID}\n`],
    [`http://br.evetools.org/br/${ID}`],
    [ID],
    [` ${ID} `],
  ])('%s', (input) => {
    expect(parseBrUrl(input)).toBe(ID)
  })
  it('lower-cases an upper-case id', () => {
    expect(parseBrUrl(ID.toUpperCase())).toBe(ID)
  })
})

describe('parseBrUrl rejects', () => {
  it.each([
    [''],
    ['   '],
    ['hello'],
    [`https://br.evetools.org/related/30002953/202611221900`],
    [`https://br.evetools.org/battle/${ID}`],
    [`https://br.evetools.org/br/${ID.slice(1)}`],
    [`https://br.evetools.org/br/${ID}0`],
    [`https://br.evetools.org/br/${'z'.repeat(24)}`],
    [`https://evil.example/br/${ID}`],
    [`https://br.evetools.org.evil.example/br/${ID}`],
    [`https://zkillboard.com/kill/123/`],
    [`https://br.evetools.org/br/${ID}/extra`],
    [`${ID}0`],
  ])('%s', (input) => {
    expect(parseBrUrl(input)).toBeNull()
  })
})
