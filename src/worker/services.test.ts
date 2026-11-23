import { describe, expect, it } from 'vitest'
import composition from '../../fixtures/br/6b035d82a6d97f0534b7e73b.composition.json'
import names from '../../fixtures/br/6b035d82a6d97f0534b7e73b.names.json'
import { fakeFetch, jsonResponse } from '../core/esi/testing'
import { createServices } from './services'

const namesById = names as Record<string, { name: string; category: string }>

describe('createServices wires the real core modules', () => {
  const { fetch, calls } = fakeFetch((call) => {
    if (call.url.includes('/newapi/br/composition/')) return jsonResponse(composition)
    if (call.url.includes('/universe/names/'))
      return jsonResponse((call.body as number[]).filter((id) => namesById[id]).map((id) => ({ id, ...namesById[id] })))
    if (call.url.includes('/universe/ids/')) return jsonResponse({ characters: [{ id: 2112292159, name: 'Some Pilot' }] })
    if (call.url.includes('/characters/affiliation/'))
      return jsonResponse([{ character_id: 2112292159, corporation_id: 98422578, alliance_id: 99015341 }])
    return new Response('unexpected', { status: 500 })
  })
  const services = createServices({} as never, { fetch, sleep: async () => {}, now: () => 1795400000000 })

  it('fetchBattleMeta returns the real BR as BattleMeta', async () => {
    const meta = await services.fetchBattleMeta('6b035d82a6d97f0534b7e73b')
    expect(meta.killmails).toHaveLength(55)
    expect(meta.fetchedAt).toBe(1795400000000)
    expect(calls.every((c) => c.headers['user-agent']?.startsWith('eve-combat-analytics'))).toBe(true)
  })
  it('resolves names and affiliations through ESI', async () => {
    expect(await services.namesToCharacters(['Some Pilot'])).toEqual({ 'Some Pilot': 2112292159 })
    expect(await services.affiliations([2112292159])).toEqual([{ charId: 2112292159, corpId: 98422578, allyId: 99015341 }])
  })
  it('looks up numeric names through ESI with the project User-Agent and a 1,000 ID batch limit', async () => {
    calls.length = 0
    const ids = [22456, ...Array.from({ length: 1_000 }, (_, i) => 900000000 + i)]
    expect(await services.idsToNames(ids)).toEqual({ 22456: { name: 'Sabre', category: 'inventory_type' } })
    expect(calls.map(({ body }) => (body as number[]).length)).toEqual([1_000, 1])
    expect(calls.every(({ url, method, headers }) => url.includes('/latest/universe/names/') && method === 'POST'
      && headers['user-agent'] === 'eve-combat-analytics (+https://github.com/FabricSoul/eve-combat-analytics)')).toBe(true)
  })

  it('parses gamelogs with the real parser', () => {
    const log = services.parseGamelog(
      '------------------------------------------------------------\n  Gamelog\n  Listener: Some Pilot\n  Session Started: 2026.11.22 20:00:00\n------------------------------------------------------------\n',
    )
    expect(log.listener).toBe('Some Pilot')
  })
})

it('cancels ESI fetches without starting another batch after the deadline', async () => {
  const controller = new AbortController()
  let calls = 0
  let enteringFetch!: (signal: AbortSignal | null | undefined) => void
  const started = new Promise<AbortSignal | null | undefined>((resolve) => { enteringFetch = resolve })
  const fetch: typeof globalThis.fetch = async (_input, init) => {
    calls++
    enteringFetch(init?.signal)
    if (calls > 1) return jsonResponse({ characters: [] })
    return new Promise<Response>((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true })
    })
  }
  const services = createServices({} as never, { fetch, sleep: async () => {}, now: Date.now })
  const result = services.namesToCharacters(Array.from({ length: 501 }, (_, i) => `Pilot ${i}`), controller.signal)
  const rejection = expect(result).rejects.toThrow('ESI POST')
  expect(await started).toBe(controller.signal)
  controller.abort()
  await rejection
  expect(calls).toBe(1)
  expect(await services.namesToCharacters(['Another Pilot'])).toEqual({ 'Another Pilot': null })
})
