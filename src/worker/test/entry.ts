import composition from '../../../fixtures/br/6b035d82a6d97f0534b7e73b.composition.json'
import names from '../../../fixtures/br/6b035d82a6d97f0534b7e73b.names.json'
import { normalizeBrComposition } from '../../core/br/normalize'
import { GamelogFormatError } from '../../core/contract'
import type { BattleMeta, LogEvent, ParsedLog } from '../../core/contract'
import { BattleRoom as ProductionBattleRoom } from '../index'

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
    other: { name, raw, corpTicker: null, allianceTicker: null, shipType: null },
  }
}

// Synthetic parser and ESI data exercise the storage and API independently of T1/T2.
export function parseGamelog(text: string): ParsedLog {
  if (text === 'invalid') throw new GamelogFormatError('no_header', 'Missing header')
  const loggingEvents = [
    event(start - 1, 1, 'Outside'),
    event(start, 2, 'Target'),
    event(start + 1, 3, 'Target'),
    event(end, 4, null, 'NPC'),
    event(end + 1, 5, 'Outside'),
  ]
  return {
    listener: text === 'unknown' ? 'Unknown Pilot' : 'Logistics Pilot',
    sessionStart: start,
    language: 'en',
    events: text === 'no overlap' ? [event(end + 1, 1, 'Outside')]
      : text === 'long log' ? Array.from({ length: 3000 }, (_, i) => event(start + i, i + 1, 'Target'))
      : text === 'replacement' ? [event(start, 1, 'Target'), event(end, 2, null, 'Second NPC')]
      : loggingEvents,
    unparsed: [{ line: 6, text: 'Unrecognized combat line' }],
  }
}

export class BattleRoom extends ProductionBattleRoom {
  protected override makeServices() {
    let fetched = false
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
        return { ...meta, brId: id, teams }
      },
      async namesToCharacters(displayNames: string[]): Promise<Record<string, number | null>> {
        const batch = [...displayNames].sort().join(',')
        switch (batch) {
          case 'Logistics Pilot': return { 'Logistics Pilot': 100 }
          case 'Unknown Pilot': return { 'Unknown Pilot': null }
          case 'Target': return { Target: 101 }
          case 'NPC,Target': return { NPC: null, Target: 101 }
          case 'Second NPC': return { 'Second NPC': null }
          default: throw new Error(`Unexpected name lookup batch: ${batch}`)
        }
      },
      async affiliations(ids: number[]) {
        if (ids.length !== 1 || (ids[0] !== 100 && ids[0] !== 101)) {
          throw new Error(`Unexpected affiliation lookup: ${ids.join(',')}`)
        }
        return ids[0] === 100
          ? [{ charId: 100, corpId: 98108724, allyId: 1042504553 }]
          : [{ charId: 101, corpId: 12345, allyId: null }]
      },
      now: () => now,
    }
  }
}
