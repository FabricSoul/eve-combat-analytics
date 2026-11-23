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
    [`https://br.evetools.org/battle/${ID}`],
    [`https://br.evetools.org/br/${ID.slice(1)}`],
    [`https://br.evetools.org/br/${ID}0`],
    [`https://br.evetools.org/br/${'z'.repeat(24)}`],
    [`https://evil.example/br/${ID}`],
    [`https://br.evetools.org.evil.example/br/${ID}`],
    [`https://zkillboard.com/kill/123/`],
    [`https://br.evetools.org/br/${ID}/extra`],
    [`${ID}0`],
    [`http://br.evetools.org/br/${ID}`],
    [`https://pilot@br.evetools.org/br/${ID}`],
    [`https://user:pw@br.evetools.org/br/${ID}`],
    [`https://br.evetools.org:444/br/${ID}`],
  ])('%s', (input) => {
    expect(parseBrUrl(input)).toBeNull()
  })
})

describe('parseBrUrl related links (F5)', () => {
  const KEY = 'related-31002058-202506221600'
  it.each([
    ['https://br.evetools.org/related/31002058/202506221600'],
    ['https://br.evetools.org/related/31002058/202506221600/'],
    ['https://www.br.evetools.org/related/31002058/202506221600?x=1#y'],
    ['https://zkillboard.com/related/31002058/202506221600/'],
    ['https://zkillboard.com/related/31002058/202506221600'],
    ['https://www.zkillboard.com/related/31002058/202506221600/?a=b'],
    ['  https://zkillboard.com/related/31002058/202506221600/ \n'],
  ])('accepts %s', (input) => {
    expect(parseBrUrl(input)).toBe(KEY)
  })
  it.each([
    ['https://br.evetools.org/related/0/202506221600'],
    ['https://br.evetools.org/related/-5/202506221600'],
    ['https://br.evetools.org/related/abc/202506221600'],
    ['https://br.evetools.org/related/1.5/202506221600'],
    ['https://br.evetools.org/related/31002058/20250622160'],
    ['https://br.evetools.org/related/31002058/2025062216000'],
    ['https://br.evetools.org/related/31002058/202513221600'],
    ['https://br.evetools.org/related/31002058/202506321600'],
    ['https://br.evetools.org/related/31002058/202506222460'],
    ['https://br.evetools.org/related/31002058/202506221660'],
    ['https://br.evetools.org/related/31002058/202502291600'],
    ['https://br.evetools.org/related/31002058'],
    ['https://br.evetools.org/related/31002058/202506221600/extra'],
    ['https://zkillboard.com/kill/128066846/'],
    ['https://zkillboard.com/br/123/'],
    ['https://zkillboard.com/battle/31002058/202506221600/'],
    ['https://br.evetools.org/battle/31002058/202506221600'],
    ['http://zkillboard.com/related/31002058/202506221600/'],
    ['https://evil.example/related/31002058/202506221600'],
  ])('rejects %s', (input) => {
    expect(parseBrUrl(input)).toBeNull()
  })
  it('accepts a leap day', () => {
    expect(parseBrUrl('https://zkillboard.com/related/1/202402291200/')).toBe('related-1-202402291200')
  })
})
