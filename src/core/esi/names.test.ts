import { describe, expect, it } from 'vitest'
import { affiliations, idsToNames, namesToCharacters } from './names'
import { fakeFetch, fakeSleep, jsonResponse } from './testing'

const mk = (f: ReturnType<typeof fakeFetch>) => ({ fetch: f.fetch, sleep: fakeSleep().sleep })

describe('idsToNames', () => {
  it('maps ids to {name, category} and de-duplicates', async () => {
    const f = fakeFetch((c) =>
      jsonResponse((c.body as number[]).map((id) => ({ id, name: `n${id}`, category: 'character' }))),
    )
    const out = await idsToNames([3, 1, 3, 1, 2], mk(f))
    expect(out).toEqual({ 1: { name: 'n1', category: 'character' }, 2: { name: 'n2', category: 'character' }, 3: { name: 'n3', category: 'character' } })
    expect(f.calls).toHaveLength(1)
    expect(f.calls[0]!.body).toEqual([3, 1, 2])
  })

  it('chunks at 1000', async () => {
    const ids = Array.from({ length: 2500 }, (_, i) => i + 1)
    const f = fakeFetch((c) => jsonResponse((c.body as number[]).map((id) => ({ id, name: 'x', category: 'character' }))))
    const out = await idsToNames(ids, mk(f))
    expect(f.calls.map((c) => (c.body as number[]).length)).toEqual([1000, 1000, 500])
    expect(Object.keys(out)).toHaveLength(2500)
  })

  it('splits a chunk on 404 and drops only the bad id', async () => {
    const BAD = 777
    const f = fakeFetch((c) => {
      const ids = c.body as number[]
      if (ids.includes(BAD)) return jsonResponse({ error: 'Invalid IDs' }, 404)
      return jsonResponse(ids.map((id) => ({ id, name: `n${id}`, category: 'character' })))
    })
    const ids = Array.from({ length: 20 }, (_, i) => 760 + i)
    const out = await idsToNames(ids, mk(f))
    expect(Object.keys(out).map(Number).sort((a, b) => a - b)).toEqual(ids.filter((i) => i !== BAD))
  })

  it('returns {} for no ids without calling ESI', async () => {
    const f = fakeFetch(() => jsonResponse([]))
    expect(await idsToNames([], mk(f))).toEqual({})
    expect(f.calls).toHaveLength(0)
  })

  it('propagates non-404 errors', async () => {
    const f = fakeFetch(() => jsonResponse({}, 400))
    await expect(idsToNames([1], mk(f))).rejects.toMatchObject({ status: 400 })
  })
})

describe('namesToCharacters', () => {
  it('matches case-insensitively, keys by input, unknown -> null', async () => {
    const f = fakeFetch(() =>
      jsonResponse({ characters: [{ id: 42, name: 'Foo Bar' }], corporations: [{ id: 9, name: 'Ghost' }] }),
    )
    const out = await namesToCharacters(['foo bar', 'Ghost', 'Nobody'], mk(f))
    expect(out).toEqual({ 'foo bar': 42, Ghost: null, Nobody: null })
    expect(f.calls[0]!.url).toContain('/universe/ids/')
    expect(f.calls[0]!.body).toEqual(['foo bar', 'Ghost', 'Nobody'])
  })

  it('treats a response without characters (ESI omits empty keys) as all unknown', async () => {
    const f = fakeFetch(() => jsonResponse({}))
    expect(await namesToCharacters(['a'], mk(f))).toEqual({ a: null })
  })

  it('chunks at 500 and de-duplicates', async () => {
    const names = Array.from({ length: 1100 }, (_, i) => `p${i}`)
    const f = fakeFetch((c) =>
      jsonResponse({ characters: (c.body as string[]).map((n) => ({ id: Number(n.slice(1)) + 1, name: n })) }),
    )
    const out = await namesToCharacters([...names, 'p0'], mk(f))
    expect(f.calls.map((c) => (c.body as string[]).length)).toEqual([500, 500, 100])
    expect(out['p1099']).toBe(1100)
    expect(Object.keys(out)).toHaveLength(1100)
  })
})

describe('affiliations', () => {
  it('returns Affiliation[] and chunks at 1000', async () => {
    const ids = Array.from({ length: 1500 }, (_, i) => i + 1)
    const f = fakeFetch((c) =>
      jsonResponse((c.body as number[]).map((id) => ({ character_id: id, corporation_id: 5, ...(id % 2 ? { alliance_id: 7 } : {}) }))),
    )
    const out = await affiliations(ids, mk(f))
    expect(f.calls.map((c) => (c.body as number[]).length)).toEqual([1000, 500])
    expect(out).toHaveLength(1500)
    expect(out[0]).toEqual({ charId: 1, corpId: 5, allyId: 7 })
    expect(out[1]).toEqual({ charId: 2, corpId: 5, allyId: null })
  })
})

describe('F1 minors', () => {
  it('namesToCharacters keeps a real own key for __proto__', async () => {
    const f = fakeFetch(() => jsonResponse({}))
    const out = await namesToCharacters(['__proto__'], mk(f))
    expect(Object.hasOwn(out, '__proto__')).toBe(true)
    expect(Object.getOwnPropertyDescriptor(out, '__proto__')!.value).toBeNull()
  })

  it.each([
    ['null', null],
    ['array for ids', []],
    ['characters not an array', { characters: 5 }],
    ['character row without id', { characters: [{ name: 'x' }] }],
  ])('namesToCharacters rejects an invalid payload (%s) with EsiError', async (_n, body) => {
    const f = fakeFetch(() => jsonResponse(body))
    await expect(namesToCharacters(['x'], mk(f))).rejects.toMatchObject({ name: 'EsiError' })
  })

  it.each([
    ['null', null],
    ['object', {}],
    ['row without name', [{ id: 1, category: 'character' }]],
  ])('idsToNames rejects an invalid payload (%s) with EsiError', async (_n, body) => {
    const f = fakeFetch(() => jsonResponse(body))
    await expect(idsToNames([1], mk(f))).rejects.toMatchObject({ name: 'EsiError' })
  })

  it.each([
    ['null', null],
    ['row without corporation_id', [{ character_id: 1 }]],
  ])('affiliations rejects an invalid payload (%s) with EsiError', async (_n, body) => {
    const f = fakeFetch(() => jsonResponse(body))
    await expect(affiliations([1], mk(f))).rejects.toMatchObject({ name: 'EsiError' })
  })
})
