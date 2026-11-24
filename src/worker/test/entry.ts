import composition from '../../../fixtures/br/6b035d82a6d97f0534b7e73b.composition.json'
import names from '../../../fixtures/br/6b035d82a6d97f0534b7e73b.names.json'
import { normalizeBrComposition } from '../../core/br/normalize'
import { GamelogFormatError } from '../../core/contract'
import type { BattleMeta, LogEvent, NameIndex, ParsedLog } from '../../core/contract'
import { parseGamelog as parseRealGamelog } from '../../core/log/parse'
import { BattleRoom as ProductionBattleRoom } from '../index'
import { USER_AGENT } from '../../core/esi/client'
import { createServices } from '../services'
import type { Services } from '../services'

export { default } from '../index'

export const now = 1795400000000
export const brId = '6b035d82a6d97f0534b7e73b'
export const start = 1795374000000
export const end = 1795388400000
export const meta = normalizeBrComposition(composition, names as BattleMeta['names'], now)
// Add a colliding corporation on an earlier side to exercise alliance precedence.
export const teams: BattleMeta['teams'] = [['corp:98108724'], ...meta.teams, ['corp:12345']]

function event(t: number, line: number, name: string | null, raw = name ?? ''): LogEvent {
  return {
    t,
    line,
    kind: 'damage',
    dir: 'out',
    amount: 100,
    quality: 'Hits',
    weapon: 'Test Turret',
    other: { name, raw, corpTicker: null, allianceTicker: null, shipType: null, shipTypeId: null },
  }
}

// Synthetic oversized metadata. Pseudorandom hashes keep its gzip payload above one chunk.
export function largeMeta(id: string): BattleMeta {
  const km = meta.killmails[0]!
  let seed = 123456789
  return {
    ...meta, brId: id, teams,
    killmails: Array.from({ length: 1100 }, (_, index) => {
      const hash = Array.from({ length: 2048 }, () => {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
        return String.fromCharCode(33 + (seed >>> 16) % 90)
      }).join('')
      return { ...km, id: index + 1, hash, attackers: Array.from({ length: 30 }, () => km.attackers[0]!) }
    }),
  }
}

// Synthetic parser and ESI data exercise the storage and API independently of T1/T2.
export function parseGamelog(text: string): ParsedLog {
  if (text === 'invalid') throw new GamelogFormatError('no_header', 'Missing header')
  const indexed = /^pilot (\d+)$/.exec(text)
  if (indexed) return {
    listener: `Synthetic Pilot ${indexed[1]}`, sessionStart: start, language: 'en',
    events: Array.from({ length: 3000 }, (_, i) => event(start + i, i + 1, 'Target')),
    unparsed: [],
  }
  const loggingEvents = [
    event(start - 1, 1, 'Outside'),
    event(start, 2, 'Target'),
    event(start + 1, 3, 'Target'),
    event(end, 4, null, 'NPC'),
    event(end + 1, 5, 'Outside'),
  ]
  return {
    listener: text === 'historical' ? 'Zeikku Targaryen' : text === 'unknown' ? 'Unknown Pilot' : 'Logistics Pilot',
    sessionStart: start,
    language: 'en',
    events: text === 'no overlap' ? [event(end + 1, 1, 'Outside')]
      : text === 'long log' ? Array.from({ length: 3000 }, (_, i) => event(start + i, i + 1, 'Target'))
      : text === 'historical' ? [event(start, 1, 'Zeikku Targaryen')]
      : text === 'many names' ? [
        event(start, 1, 'Fake [CORP]'),
        event(start, 2, 'X'.repeat(38)),
        event(start, 3, 'NPC*'),
        ...Array.from({ length: 2001 }, (_, i) => event(start + i, i + 4, `Candidate ${i}`)),
      ]
      : text === 'budgeted names' ? Array.from({ length: 550 }, (_, i) => event(start + i, i + 1, `Budget Target ${i}`))
      : text === 'type labels' ? [
        event(start, 1, 'Target'), event(start, 2, 'Cenotaph'), event(start, 3, 'Acolyte II'),
        event(start, 4, 'Caldari Navy Mjolnir Rocket'), event(start, 5, null, 'Leshak'),
      ]
      : text === 'slow names' ? [event(start, 1, 'Timed Target')]
      : text === 'replacement' ? [event(start, 1, 'Target'), event(end, 2, null, 'Second NPC')]
      : loggingEvents,
    unparsed: Array.from({ length: text === 'many unknown' ? 550 : 1 }, (_, i) => ({ line: 6 + i, text: 'Unrecognized combat line' })),
  }
}

export const realFightId = '000000000000000000125990'

declare global {
  namespace Cloudflare {
    interface Env {
      REAL_FIGHT_INFO: {
        meta: BattleMeta
        names: NameIndex
        listeners: { charId: number; charName: string; side: number }[]
        expected: { interactions: number; jsonBytes: number; nodeMilliseconds: number }
      }
      REAL_FIGHT_LOGS: Fetcher
    }
  }
}

function realFightServices({ meta, names, listeners }: Cloudflare.Env['REAL_FIGHT_INFO']): Services {
  const characters = new Map(Object.entries(names).map(([name, entry]) => [name, entry?.charId ?? null]))
  const sides = new Map(Object.values(names).flatMap((entry) => entry ? [[entry.charId, entry.side]] as const : []))
  for (const { charName, charId, side } of listeners) {
    characters.set(charName, charId)
    sides.set(charId, side)
  }
  return {
    parseGamelog: parseRealGamelog,
    async fetchBattleMeta(brId) { return { ...meta, brId } },
    async idsToNames(ids) {
      return Object.fromEntries(ids.flatMap((id) => meta.names[id] ? [[id, meta.names[id]]] : []))
    },
    async namesToCharacters(names) { return Object.fromEntries(names.map((name) => [name, characters.get(name) ?? null])) },
    async affiliations(ids) {
      return ids.map((charId) => {
        const member = meta.teams[sides.get(charId) ?? -1]?.[0]
        const [kind, id] = member?.split(':') ?? []
        return { charId, corpId: kind === 'corp' ? Number(id) : 1, allyId: kind === 'ally' ? Number(id) : null }
      })
    },
    async affiliationHistory() { throw new Error('No recorded history in this fixture') },
    async wait() {},
    now: () => now,
  }
}

export class BattleRoom extends ProductionBattleRoom {
  protected readonly uploadEsiTimeoutMs = 100
  protected readonly analysisDelayMs = 60_000
  protected override makeServices() {
    if (this.ctx.id.name === realFightId) return realFightServices((this.env as Cloudflare.Env).REAL_FIGHT_INFO)
    const testHistory = /b7[123]$/.test(this.ctx.id.name ?? '')
    const failHistory = this.ctx.id.name?.endsWith('b72')
    const battleStart = Math.min(...meta.windows.map(({ start }) => start))
    const date = (offset: number) => new Date(battleStart + offset).toISOString()
    const historyServices = createServices(this.env, {
      now: () => now, sleep: async () => {},
      async fetch(input, init) {
        const { pathname } = new URL(String(input))
        if (new Headers(init?.headers).get('user-agent') !== USER_AGENT) return new Response(null, { status: 400 })
        if (pathname === '/latest/characters/affiliation/') {
          const ids: number[] = JSON.parse(String(init?.body))
          return Response.json(ids.map((character_id) => ({ character_id, corporation_id: 12345 })))
        }
        if (init?.method !== 'GET') return new Response(null, { status: 405 })
        if (/^\/latest\/characters\/(100|101)\/corporationhistory\/$/.test(pathname)) {
          if (failHistory && pathname.includes('/101/')) return new Response(null, { status: 502 })
          return Response.json([
            { corporation_id: 12345, start_date: date(1), record_id: 3 },
            { corporation_id: 98108724, start_date: date(0), record_id: 2 },
            { corporation_id: 12345, start_date: date(-1), record_id: 1 },
          ])
        }
        if (pathname === '/latest/corporations/98108724/alliancehistory/') {
          return Response.json([
            { alliance_id: 1042504553, start_date: date(-1), record_id: 1 },
            { start_date: date(0), record_id: 2 },
          ])
        }
        return new Response(null, { status: 404 })
      },
    })
    let fetched = false
    let slow = true
    let slowBatch = true
    let failMetaNames = this.ctx.id.name?.endsWith('a02')
    const resolveMetaNames = failMetaNames || this.ctx.id.name?.endsWith('a01')
    return {
      parseGamelog,
      async fetchBattleMeta(id: string): Promise<BattleMeta> {
        if (fetched) throw new Error('BR fetched twice from the same instance')
        fetched = true
        if (id === '000000000000000000000404') {
          throw Object.assign(new Error('BR missing'), { code: 'br_not_found' })
        }
        if (id === '000000000000000000000502') {
          throw Object.assign(new Error('BR upstream unavailable'), { code: 'br_unavailable' })
        }
        if (id.endsWith('909')) {
          // Synthetic BR teams test editability above the normal creation cap.
          return { ...meta, brId: id, teams: Array.from({ length: 9 }, () => []) }
        }
        return id.endsWith('b16') ? largeMeta(id) : { ...meta, brId: id, teams }
      },
      async namesToCharacters(displayNames: string[]): Promise<Record<string, number | null>> {
        if (displayNames.some((name) => name.startsWith('Budget Target '))) {
          if (slowBatch && displayNames.includes('Budget Target 500')) {
            slowBatch = false
            await new Promise((resolve) => setTimeout(resolve, 400))
          }
          return Object.fromEntries(displayNames.map((name) => [name, null]))
        }
        if (displayNames.every((name) => /^Candidate \d+$/.test(name))) {
          return Object.fromEntries(displayNames.map((name) => [name, null]))
        }
        if (displayNames.some((name) => /^Synthetic Pilot \d+$/.test(name))) {
          return Object.fromEntries(displayNames.map((name) => [name, 10000 + Number(name.split(' ').at(-1))]))
        }
        if (displayNames.includes('Timed Target')) {
          if (slow) {
            slow = false
            await new Promise((resolve) => setTimeout(resolve, 400))
          }
          return Object.fromEntries(displayNames.map((name) => [name, null]))
        }
        if (displayNames.includes('Candidate 2000')) {
          return Object.fromEntries(displayNames.map((name) => [name, name === 'Target' ? 101 : null]))
        }
        const batch = [...displayNames].sort().join(',')
        switch (batch) {
          case 'Logistics Pilot': return { 'Logistics Pilot': 100 }
          case 'Unknown Pilot': return { 'Unknown Pilot': null }
          case 'Zeikku Targaryen': return { 'Zeikku Targaryen': 2113179297 }
          case 'Target': return { Target: 101 }
          case 'NPC,Target': return { NPC: null, Target: 101 }
          case 'Second NPC': return { 'Second NPC': null }
          default: throw new Error(`Unexpected name lookup batch: ${batch}`)
        }
      },
      async idsToNames(ids: number[]) {
        if (!resolveMetaNames) return {}
        if (failMetaNames) {
          failMetaNames = false
          throw new Error('Temporary ESI name lookup failure')
        }
        // Synthetic ESI name responses, using fixture IDs and an NPC corporation.
        const known: BattleMeta['names'] = {
          100: { name: 'Logistics Pilot', category: 'character' },
          101: { name: 'Target', category: 'character' },
          1000165: { name: 'Hedion University', category: 'corporation' },
          98108724: { name: 'Listener Corporation', category: 'corporation' },
          1042504553: { name: 'Listener Alliance', category: 'alliance' },
        }
        return Object.fromEntries(ids.filter((id) => known[id]).map((id) => [id, known[id]!]))
      },
      affiliations: testHistory ? historyServices.affiliations : async (ids: number[]) => {
        if (ids[0] === 2113179297 || (ids[0] ?? 0) >= 10000) {
          return ids.map((charId) => ({ charId, corpId: 1, allyId: null }))
        }
        if (ids.length !== 1 || (ids[0] !== 100 && ids[0] !== 101)) {
          throw new Error(`Unexpected affiliation lookup: ${ids.join(',')}`)
        }
        return ids[0] === 100
          ? [{ charId: 100, corpId: 98108724, allyId: 1042504553 }]
          : [{ charId: 101, corpId: resolveMetaNames ? 1000165 : 12345, allyId: null }]
      },
      affiliationHistory: testHistory ? historyServices.affiliationHistory
        : async () => { throw new Error('No recorded history in this fixture') },
      wait: historyServices.wait,
      now: () => now,
    }
  }
}
