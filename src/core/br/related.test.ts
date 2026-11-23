import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { BattleMeta } from '../contract'
import { ApiFailure } from '../esi/client'
import { fakeFetch, fakeSleep, jsonResponse } from '../esi/testing'
import { fetchBattleMeta } from './fetch'
import { sideOf } from './normalize'

const dir = new URL('../../../fixtures/real/j125990-20250622/', import.meta.url)
const related = JSON.parse(readFileSync(new URL('related.json', dir), 'utf8')) as { kms: { time: number }[] }
const esi = JSON.parse(readFileSync(new URL('esi.json', dir), 'utf8')) as {
  names: Record<string, { name: string; category: string }>
  teams: string[][]
  listeners: { charId: number; charName: string; side: number }[]
}
const SPLIT = [84, 11] // distinct pilots per inferred side on J125990 (side 0 = the uploaders' side)
const KEY = 'related-31002058-202506221600'
const URL_ = 'https://br.evetools.org/newapi/br/related/31002058/202506221600'
const NOW = 1_800_000_000_000

function server(brHandler: (n: number) => Response) {
  let n = 0
  return fakeFetch((c) => {
    if (c.url === URL_) return brHandler(++n)
    if (c.url.includes('/universe/names/')) {
      return jsonResponse((c.body as number[]).filter((i) => esi.names[i]).map((id) => ({ id, ...esi.names[id]! })))
    }
    throw new Error(`unexpected ${c.url}`)
  })
}
const deps = (f: ReturnType<typeof fakeFetch>) => ({ fetch: f.fetch, sleep: fakeSleep().sleep, now: () => NOW })

describe('fetchBattleMeta for a related key', () => {
  let meta: BattleMeta
  it('builds a BattleMeta from the real J125990 related response', async () => {
    const f = server(() => jsonResponse(related))
    meta = await fetchBattleMeta(KEY, deps(f))
    expect(meta.brId).toBe(KEY)
    expect(meta.source).toBe('br.evetools.related')
    expect(meta.fetchedAt).toBe(NOW)
    expect(meta.killmails).toHaveLength(52)
    expect(f.calls[0]!.url).toBe(URL_)
    expect(f.calls.every((c) => c.headers['user-agent']?.startsWith('eve-combat-analytics'))).toBe(true)
    expect(Object.keys(meta.names).length).toBeGreaterThan(50)
  })

  it('has one window: first..last killmail ±15 min, inside datetime −1 h … +2 h', async () => {
    const f = server(() => jsonResponse(related))
    meta = await fetchBattleMeta(KEY, deps(f))
    const ts = related.kms.map((k) => k.time)
    expect(meta.windows).toEqual([
      { systemId: 31002058, systemName: 'J125990', regionName: 'E-R00025', security: -1, start: Math.min(...ts) - 900_000, end: Math.max(...ts) + 900_000 },
    ])
    // the start margin matches the committed fixture's hand-made window
    expect(meta.windows[0]!.start).toBe(1750606047000)
  })

  it('clips the window to the API window (time −1 h … +2 h)', async () => {
    const early = { ...related, kms: related.kms.map((k, i) => (i === 0 ? { ...k, time: Date.UTC(2025, 5, 22, 15, 5) } : k)) }
    const f = server(() => jsonResponse(early))
    const m = await fetchBattleMeta(KEY, deps(f))
    expect(m.windows[0]!.start).toBe(Date.UTC(2025, 5, 22, 15, 0)) // 16:00 − 1 h, not 14:50
    const late = { ...related, kms: related.kms.map((k, i) => (i === 0 ? { ...k, time: Date.UTC(2025, 5, 22, 17, 55) } : k)) }
    const g = server(() => jsonResponse(late))
    expect((await fetchBattleMeta(KEY, deps(g))).windows[0]!.end).toBe(Date.UTC(2025, 5, 22, 18, 0))
  })

  it('infers two sides that keep the uploaders together, reports the split', async () => {
    const f = server(() => jsonResponse(related))
    meta = await fetchBattleMeta(KEY, deps(f))
    expect(meta.teams).toHaveLength(2)
    // every member of the uploaders' side (esi.teams[0]) must land on one inferred side
    const present = new Set(meta.teams.flat())
    const uploaderMembers = esi.teams[0]!.filter((m) => present.has(m as never))
    const sides = new Set(uploaderMembers.map((m) => meta.teams.findIndex((t) => t.includes(m as never))))
    expect(uploaderMembers.length).toBeGreaterThan(0)
    expect(sides.size).toBe(1)
    const uploaderSide = [...sides][0]!
    // pilots per side, counted on killmail participants
    const pilots = [new Set<number>(), new Set<number>()]
    for (const k of meta.killmails) {
      for (const p of [k.victim, ...k.attackers]) {
        const s = sideOf(p, meta.teams)
        if (p.charId !== null && s >= 0) pilots[s]!.add(p.charId)
      }
    }
    expect(uploaderSide).toBe(0)
    expect([pilots[0]!.size, pilots[1]!.size]).toEqual(SPLIT)
    expect(pilots[0]!.size).toBeGreaterThanOrEqual(pilots[1]!.size)
  })

  it('404 -> br_not_found, 500x3 -> br_unavailable', async () => {
    await expect(fetchBattleMeta(KEY, deps(server(() => jsonResponse({}, 404))))).rejects.toMatchObject({ code: 'br_not_found' })
    const err = await fetchBattleMeta(KEY, deps(server(() => jsonResponse({}, 500)))).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiFailure)
    expect((err as ApiFailure).code).toBe('br_unavailable')
  })

  it.each([
    ['no kms', { ...related, kms: [] }],
    ['result not success', { ...related, result: 'error' }],
    ['other system', { ...related, systemID: 30000142 }],
    ['other datetime', { ...related, datetime: '202506221700' }],
    ['kms not an array', { ...related, kms: 5 }],
    ['no system', { ...related, system: null }],
    ['malformed km', { ...related, kms: [null] }],
    ['null body', null],
  ])('rejects an invalid related body (%s) with br_not_found', async (_n, body) => {
    const f = server(() => jsonResponse(body))
    await expect(fetchBattleMeta(KEY, deps(f))).rejects.toMatchObject({ code: 'br_not_found' })
    expect(f.calls.map((c) => c.url)).toEqual([URL_])
  })

  it('rejects a key that is neither a BR id nor a related key', async () => {
    await expect(fetchBattleMeta('nonsense', deps(server(() => jsonResponse({}))))).rejects.toMatchObject({ code: 'br_not_found' })
  })
})
