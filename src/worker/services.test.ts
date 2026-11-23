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
  it('parses gamelogs with the real parser', () => {
    const log = services.parseGamelog(
      '------------------------------------------------------------\n  Gamelog\n  Listener: Some Pilot\n  Session Started: 2026.11.22 20:00:00\n------------------------------------------------------------\n',
    )
    expect(log.listener).toBe('Some Pilot')
  })
})
