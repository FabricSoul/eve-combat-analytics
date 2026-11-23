// Synthetic battle states. Every name, ID, timestamp and combat number below is invented.
import type {
  BattleState,
  Counterparty,
  Killmail,
  KillmailParticipant,
  LogEvent,
  NameIndex,
  UploadedLog,
} from '../../src/core/contract'

export const battleStart = 1_795_374_000_000
export const at = (seconds: number) => battleStart + seconds * 1000

export function other(name: string | null, shipType: string | null = null, raw = name ?? ''): Counterparty {
  return { raw, name, corpTicker: null, allianceTicker: null, shipType, shipTypeId: null }
}

type EventFields = Omit<Extract<LogEvent, { kind: 'damage' }>, 't' | 'line' | 'other'>
  | Omit<Extract<LogEvent, { kind: 'miss' }>, 't' | 'line' | 'other'>
  | Omit<Extract<LogEvent, { kind: 'repair' }>, 't' | 'line' | 'other'>
  | Omit<Extract<LogEvent, { kind: 'neut' | 'nos' }>, 't' | 'line' | 'other'>
  | Omit<Extract<LogEvent, { kind: 'ewar' }>, 't' | 'line' | 'other'>

export function event(sec: number, target: string | Counterparty, fields: EventFields): LogEvent {
  return { t: at(sec), line: 0, other: typeof target === 'string' ? other(target) : target, ...fields }
}

export function hit(
  sec: number,
  target: string | Counterparty,
  amount: number,
  fields: Partial<Omit<Extract<LogEvent, { kind: 'damage' }>, 'kind' | 'amount' | 't' | 'line' | 'other'>> = {},
): LogEvent {
  return event(sec, target, { kind: 'damage', dir: 'out', amount, weapon: 'Laser', quality: 'Hits', ...fields })
}

export function log(charId: number, charName: string, side: number, events: LogEvent[]): UploadedLog {
  return {
    id: String(charId).padStart(64, '0'),
    charId,
    charName,
    side,
    uploadedAt: at(60),
    parsed: {
      listener: charName,
      sessionStart: at(0),
      language: 'en',
      events: events.map((entry, index) => ({ ...entry, line: index + 1 })).sort((a, b) => a.t - b.t || a.line - b.line),
      unparsed: [],
    },
  }
}

export function pilot(charId: number, corpId: number, shipTypeId: number, damage = 0): KillmailParticipant {
  return { charId, corpId, allyId: null, shipTypeId, weaponTypeId: null, damage }
}

export function kill(id: number, sec: number, victim: KillmailParticipant, attackers: KillmailParticipant[]): Killmail {
  return { id, hash: String(id), systemId: 1, t: at(sec), value: 0, victim, attackers }
}

const names: NameIndex = {
  Ace: { charId: 1, side: 0 },
  Wing: { charId: 2, side: 0 },
  Rook: { charId: 3, side: 1 },
  Bishop: { charId: 4, side: 1 },
  Medic: { charId: 5, side: 0 },
  Knight: { charId: 6, side: 1 },
}

export function battle(logs: UploadedLog[], killmails: Killmail[] = []): BattleState {
  return {
    meta: {
      brId: 'synthetic',
      source: 'br.evetools',
      fetchedAt: at(80),
      windows: [],
      teams: [['corp:100'], ['corp:200']],
      killmails,
      names: {
        3: { name: 'Rook', category: 'character' },
        5: { name: 'Medic', category: 'character' },
        7: { name: 'Scout', category: 'character' },
        1000: { name: 'Frigate', category: 'inventory_type' },
        1001: { name: 'Cruiser', category: 'inventory_type' },
      },
    },
    logs,
    fits: [],
    names,
  }
}

export const exchange = () => battle([
  log(1, 'Ace', 0, [
    hit(0.25, other('Rook', 'Cruiser'), 100, { weapon: null, quality: 'none' }),
    hit(0.25, other('Rook', 'Frigate'), 100, { weapon: 'Railgun' }),
    hit(0.25, 'Rook', 100, { weapon: 'Cannon' }),
    event(1.25, 'Rook', { kind: 'miss', dir: 'out', weapon: 'Laser' }),
    hit(2, other(null, 'Sentry Gun', 'Automated Sentry'), 45, { dir: 'in' }),
    hit(6, 'Rook', 50),
  ]),
  log(3, 'Rook', 1, [
    hit(1.25, 'Ace', 100, { dir: 'in', weapon: 'Railgun', quality: 'Smashes' }),
    hit(1.25, 'Ace', 100, { dir: 'in', weapon: null }),
    event(2.25, 'Ace', { kind: 'miss', dir: 'in', weapon: null }),
    hit(7.001, 'Ace', 50, { dir: 'in' }),
  ]),
], [kill(1, 12, pilot(3, 200, 1000), [pilot(1, 100, 1001, 500), pilot(7, 100, 1000, 100)])])

export const pilotComparison = () => battle([
  log(1, 'Ace', 0, [
    hit(0, 'Rook', 60),
    hit(1, 'Rook', 40, { quality: 'Smashes' }),
    event(2, 'Rook', { kind: 'miss', dir: 'out', weapon: 'Laser' }),
    hit(3, 'Rook', 100, { dir: 'in' }),
    event(4, 'Medic', { kind: 'repair', dir: 'out', amount: 25, repairType: 'armor', module: 'Repairer' }),
    event(5, 'Medic', { kind: 'repair', dir: 'in', amount: 30, repairType: 'shield', module: null }),
    event(6, 'Rook', { kind: 'neut', dir: 'out', amount: 8, module: 'Neutralizer' }),
    event(7, 'Rook', { kind: 'neut', dir: 'in', amount: 9, module: null }),
    event(7, 'Rook', { kind: 'nos', dir: 'out', amount: 50, module: 'Nosferatu' }),
    event(8, 'Rook', { kind: 'ewar', dir: 'out', ewar: 'warp_scramble' }),
    event(9, 'Rook', { kind: 'ewar', dir: 'out', ewar: 'web' }),
    event(11, 'Medic', { kind: 'repair', dir: 'out', amount: 25, repairType: 'armor', module: 'Repairer' }),
    hit(20, 'Bishop', 80),
    event(22, 'Rook', { kind: 'ewar', dir: 'out', ewar: 'warp_scramble' }),
    event(23, 'Rook', { kind: 'ewar', dir: 'out', ewar: 'warp_disrupt' }),
    event(37, 'Rook', { kind: 'ewar', dir: 'out', ewar: 'warp_scramble' }),
    hit(40, 'Rook', 10, { quality: 'none' }),
    event(42, 'Medic', { kind: 'repair', dir: 'out', amount: 25, repairType: 'armor', module: 'Repairer' }),
  ]),
  log(2, 'Wing', 0, [hit(1, 'Rook', 20), hit(20, 'Bishop', 20)]),
  log(3, 'Rook', 1, [
    hit(2, 'Medic', 100),
    hit(3, 'Ace', 100),
    hit(12, 'Medic', 100),
    hit(13, 'Medic', 100),
  ]),
], [
  kill(1, 25, pilot(4, 200, 1000), [pilot(1, 100, 1001, 500), pilot(1, 100, 1000, 40)]),
  kill(2, 50, pilot(1, 100, 1000), [pilot(5, 100, 1001, 70)]),
])

export function primaryThreshold(damage: number, secondShooter: boolean): BattleState {
  const ace = [hit(0, 'Rook', damage - 20), hit(0, 'Bishop', 35), hit(0, 'Knight', 65 - damage)]
  const wing = [hit(0, 'Rook', 20)]
  return battle([
    log(1, 'Ace', 0, secondShooter ? ace : [...ace, ...wing]),
    log(2, 'Wing', 0, secondShooter ? wing : []),
  ])
}

export const primaryGaps = () => battle([
  log(1, 'Ace', 0, [0, 11, 25, 40].map((sec) => hit(sec, 'Rook', 100))),
  log(2, 'Wing', 0, [0, 11, 25, 40].map((sec) => hit(sec, 'Rook', 50))),
], [
  kill(1, 36, pilot(3, 200, 1000), []),
  kill(2, 51.001, pilot(3, 200, 1001), []),
])
