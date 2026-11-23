import { describe, expect, it } from 'vitest'
import composition from '../../../fixtures/br/6b035d82a6d97f0534b7e73b.composition.json'
import names from '../../../fixtures/br/6b035d82a6d97f0534b7e73b.names.json'
import { ApiFailure } from '../esi/client'
import { fakeFetch, fakeSleep, jsonResponse } from '../esi/testing'
import { fetchBattleMeta } from './fetch'

const ID = '6b035d82a6d97f0534b7e73b'
const BR_URL = `https://br.evetools.org/newapi/br/composition/${ID}`
const NOW = 1795400000000
const nameTable = names as Record<string, { name: string; category: string }>

function esiNames(ids: number[]): Response {
  return jsonResponse(ids.filter((i) => nameTable[i]).map((id) => ({ id, ...nameTable[id]! })))
}

function server(brHandler: (n: number) => Response) {
  let n = 0
  return fakeFetch((c) => {
    if (c.url === BR_URL) return brHandler(++n)
    if (c.url.includes('/universe/names/')) return esiNames(c.body as number[])
    throw new Error(`unexpected ${c.url}`)
  })
}
const deps = (f: ReturnType<typeof fakeFetch>, s = fakeSleep()) => ({ fetch: f.fetch, sleep: s.sleep, now: () => NOW })

describe('fetchBattleMeta', () => {
  it('turns the real BR into a BattleMeta with names', async () => {
    const f = server(() => jsonResponse(composition))
    const meta = await fetchBattleMeta(ID, deps(f))
    expect(meta.killmails).toHaveLength(55)
    expect(meta.windows).toHaveLength(5)
    expect(meta.names[22456]!.name).toBe('Sabre')
    expect(meta.fetchedAt).toBe(NOW)
    expect(meta.brId).toBe(ID)
    expect(f.calls.every((c) => c.headers['user-agent']?.startsWith('eve-combat-analytics'))).toBe(true)
  })

  it('polls while processing (every 2 s) and then succeeds', async () => {
    const f = server((n) => jsonResponse(n < 3 ? { status: 'processing' } : composition))
    const s = fakeSleep()
    const meta = await fetchBattleMeta(ID, deps(f, s))
    expect(meta.killmails).toHaveLength(55)
    expect(s.sleeps).toEqual([2000, 2000])
  })

  it('fails br_unavailable when still processing after 30 s', async () => {
    const f = server(() => jsonResponse({ status: 'processing' }))
    const s = fakeSleep()
    const err = (await fetchBattleMeta(ID, deps(f, s)).catch((e: unknown) => e)) as ApiFailure
    expect(err).toBeInstanceOf(ApiFailure)
    expect(err.code).toBe('br_unavailable')
    expect(s.sleeps.reduce((a, b) => a + b, 0)).toBe(30000)
  })

  it('404 -> br_not_found', async () => {
    const f = server(() => jsonResponse({}, 404))
    await expect(fetchBattleMeta(ID, deps(f))).rejects.toMatchObject({ code: 'br_not_found' })
  })

  it.each([['empty object', {}], ['null', null], ['array', []]])('invalid body (%s) -> br_not_found', async (_n, body) => {
    const f = server(() => jsonResponse(body))
    await expect(fetchBattleMeta(ID, deps(f))).rejects.toMatchObject({ code: 'br_not_found' })
  })

  it('non-JSON body -> br_not_found', async () => {
    const f = server(() => new Response('<html>', { status: 200 }))
    await expect(fetchBattleMeta(ID, deps(f))).rejects.toMatchObject({ code: 'br_not_found' })
  })

  it('500 three times -> br_unavailable', async () => {
    const f = server(() => jsonResponse({}, 500))
    const s = fakeSleep()
    await expect(fetchBattleMeta(ID, deps(f, s))).rejects.toMatchObject({ code: 'br_unavailable' })
    expect(f.calls.filter((c) => c.url === BR_URL)).toHaveLength(3)
  })

  it('500 then success recovers', async () => {
    const f = server((n) => (n === 1 ? jsonResponse({}, 500) : jsonResponse(composition)))
    expect((await fetchBattleMeta(ID, deps(f))).killmails).toHaveLength(55)
  })

  it('network error -> br_unavailable', async () => {
    const f = fakeFetch(() => {
      throw new TypeError('offline')
    })
    await expect(fetchBattleMeta(ID, deps(f))).rejects.toMatchObject({ code: 'br_unavailable' })
  })

  it('ESI failure while naming -> br_unavailable', async () => {
    const f = fakeFetch((c) => (c.url === BR_URL ? jsonResponse(composition) : jsonResponse({}, 400)))
    await expect(fetchBattleMeta(ID, deps(f))).rejects.toMatchObject({ code: 'br_unavailable' })
  })
})
