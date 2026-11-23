import type { BattleMeta, Killmail, KillmailParticipant, SystemWindow, TeamMember } from '../contract'

/** Raw shapes of GET br.evetools.org/newapi/br/composition/<id>, as observed 2026-11-22. */
interface RawParticipant {
  ally?: number
  corp?: number
  char?: number
  ship?: number
  weap?: number
  dmg?: number
}
export interface RawKm {
  id: number
  hash: string
  system: number
  time: number
  totalValue: number
  victim: RawParticipant
  attackers?: RawParticipant[]
}
interface RawRelated {
  start: number
  end: number
  systemID: number
  system: { name: string; region: string; ss: string | number }
  kms?: RawKm[]
}
interface RawComposition {
  id: string
  teams: (string | number)[][]
  relateds: RawRelated[]
}

const idOrNull = (v: number | undefined): number | null => (v && v > 0 ? v : null)

export function participant(p: RawParticipant): KillmailParticipant {
  return {
    charId: idOrNull(p.char),
    corpId: idOrNull(p.corp),
    allyId: idOrNull(p.ally),
    shipTypeId: idOrNull(p.ship),
    weaponTypeId: idOrNull(p.weap),
    damage: p.dmg ?? 0,
  }
}

function teamMember(x: string | number): TeamMember {
  const s = String(x)
  return s.startsWith('corp:') ? (s as TeamMember) : (`ally:${Number(s)}` as TeamMember)
}

export function killmailOf(k: RawKm): Killmail {
  return {
    id: k.id,
    hash: k.hash,
    systemId: k.system,
    t: k.time,
    value: k.totalValue,
    victim: participant(k.victim),
    attackers: (k.attackers ?? []).map(participant),
  }
}

export function normalizeBrComposition(raw: unknown, names: BattleMeta['names'], fetchedAt: number): BattleMeta {
  const c = raw as RawComposition
  if (!c || typeof c.id !== 'string' || !Array.isArray(c.relateds) || !Array.isArray(c.teams)) {
    throw new Error('not a BR composition')
  }
  const windows: SystemWindow[] = c.relateds.map((r) => ({
    systemId: r.systemID,
    systemName: r.system.name,
    regionName: r.system.region,
    security: Number(r.system.ss),
    start: r.start * 1000,
    end: r.end * 1000,
  }))
  const seen = new Set<number>()
  const killmails: Killmail[] = []
  for (const r of c.relateds) {
    for (const k of r.kms ?? []) {
      if (seen.has(k.id)) continue
      seen.add(k.id)
      killmails.push(killmailOf(k))
    }
  }
  killmails.sort((a, b) => a.t - b.t || a.id - b.id)
  return {
    brId: c.id,
    source: 'br.evetools',
    fetchedAt,
    windows,
    teams: c.teams.map((t) => t.map(teamMember)),
    killmails,
    names,
  }
}

/** Side index of a participant: an alliance match on any team wins over a corp match, else -1. */
export function sideOf(p: { allyId: number | null; corpId: number | null }, teams: TeamMember[][]): number {
  const { allyId, corpId } = p
  if (allyId !== null) {
    const ally: TeamMember = `ally:${allyId}`
    const i = teams.findIndex((t) => t.includes(ally))
    if (i >= 0) return i
  }
  if (corpId !== null) {
    const corp: TeamMember = `corp:${corpId}`
    return teams.findIndex((t) => t.includes(corp))
  }
  return -1
}
