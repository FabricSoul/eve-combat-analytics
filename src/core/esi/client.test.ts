import { describe, expect, it } from 'vitest'
import { ESI_BASE, EsiError, USER_AGENT, esiRequest } from './client'
import { fakeFetch, fakeSleep, jsonResponse } from './testing'

describe('esiRequest', () => {
  it('sends the User-Agent, datasource and JSON body to the ESI base', async () => {
    const f = fakeFetch(() => jsonResponse([1]))
    const out = await esiRequest({ fetch: f.fetch, sleep: fakeSleep().sleep }, 'POST', '/universe/names/', [5])
    expect(out).toEqual([1])
    const c = f.calls[0]!
    expect(c.url).toBe(`${ESI_BASE}/universe/names/?datasource=tranquility`)
    expect(c.method).toBe('POST')
    expect(c.headers['user-agent']).toBe(USER_AGENT)
    expect(USER_AGENT).toBe('eve-combat-analytics (+https://github.com/FabricSoul/eve-combat-analytics)')
    expect(c.body).toEqual([5])
  })

  it('waits X-ESI-Error-Limit-Reset seconds before the next call when remain < 10', async () => {
    const f = fakeFetch((_c, n) =>
      jsonResponse({}, 200, n === 1 ? { 'x-esi-error-limit-remain': '9', 'x-esi-error-limit-reset': '17' } : {}),
    )
    const s = fakeSleep()
    const deps = { fetch: f.fetch, sleep: s.sleep }
    await esiRequest(deps, 'GET', '/a/')
    expect(s.sleeps).toEqual([])
    await esiRequest(deps, 'GET', '/b/')
    expect(s.sleeps).toEqual([17000])
    await esiRequest(deps, 'GET', '/c/')
    expect(s.sleeps).toEqual([17000])
  })

  it('does not wait when remain is 10 or more', async () => {
    const f = fakeFetch(() => jsonResponse({}, 200, { 'x-esi-error-limit-remain': '10', 'x-esi-error-limit-reset': '30' }))
    const s = fakeSleep()
    const deps = { fetch: f.fetch, sleep: s.sleep }
    await esiRequest(deps, 'GET', '/a/')
    await esiRequest(deps, 'GET', '/b/')
    expect(s.sleeps).toEqual([])
  })

  it('retries 502/503/504 twice with backoff, then succeeds', async () => {
    const f = fakeFetch((_c, n) => (n < 3 ? jsonResponse({}, n === 1 ? 502 : 503) : jsonResponse({ ok: 1 })))
    const s = fakeSleep()
    expect(await esiRequest({ fetch: f.fetch, sleep: s.sleep }, 'GET', '/x/')).toEqual({ ok: 1 })
    expect(f.calls).toHaveLength(3)
    expect(s.sleeps).toHaveLength(2)
    expect(s.sleeps[1]!).toBeGreaterThan(s.sleeps[0]!)
  })

  it('throws EsiError after three 504s', async () => {
    const f = fakeFetch(() => jsonResponse({ error: 'boom' }, 504))
    await expect(esiRequest({ fetch: f.fetch, sleep: fakeSleep().sleep }, 'GET', '/x/')).rejects.toMatchObject({
      name: 'EsiError',
      status: 504,
    })
    expect(f.calls).toHaveLength(3)
  })

  it('throws EsiError with the status on 404 and does not retry', async () => {
    const f = fakeFetch(() => jsonResponse({ error: 'nope' }, 404))
    const err = (await esiRequest({ fetch: f.fetch, sleep: fakeSleep().sleep }, 'POST', '/x/', []).catch((e: unknown) => e)) as EsiError
    expect(err).toBeInstanceOf(EsiError)
    expect(err.status).toBe(404)
    expect(f.calls).toHaveLength(1)
  })

  it('wraps a network failure in EsiError with status 0', async () => {
    const f = fakeFetch(() => {
      throw new TypeError('offline')
    })
    const err = (await esiRequest({ fetch: f.fetch, sleep: fakeSleep().sleep }, 'GET', '/x/').catch((e: unknown) => e)) as EsiError
    expect(err).toBeInstanceOf(EsiError)
    expect(err.status).toBe(0)
  })
})
