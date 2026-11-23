// Offline loader for the real J125990 fight (see README.md). Node-only: tests use it, product code does not.
import { readFileSync, readdirSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'
import { parseGamelog } from '../../../src/core/log/parse'
import { normalizeBrComposition, sideOf } from '../../../src/core/br/normalize'
import type { BattleMeta, BattleState, Killmail, KillmailParticipant, NameIndex, ParsedLog, TeamMember, UploadedLog } from '../../../src/core/contract'

const root = new URL('./', import.meta.url)

export function realLogTexts(): { file: string; text: string }[] {
  const dir = new URL('logs/', root)
  return readdirSync(dir)
    .filter((f) => f.endsWith('.txt.gz'))
    .sort()
    .map((f) => ({ file: f.replace(/\.gz$/, ''), text: gunzipSync(readFileSync(new URL(f, dir))).toString('utf8') }))
}

interface EsiFixture {
  windows: BattleMeta['windows']
  teams: TeamMember[][]
  names: BattleMeta['names']
  nameIndex: NameIndex
  listeners: { file: string; charId: number; charName: string; side: number; corpId?: number | null; allyId?: number | null }[]
}

type RawParticipant = Partial<Record<'char' | 'corp' | 'ally' | 'ship' | 'weap' | 'dmg', number>>
interface RawKm { id: number; hash: string; system: number; time: number; totalValue: number; victim: RawParticipant; attackers?: RawParticipant[] }

const participant = (x: RawParticipant): KillmailParticipant => ({
  charId: x.char || null,
  corpId: x.corp || null,
  allyId: x.ally || null,
  shipTypeId: x.ship || null,
  weaponTypeId: x.weap || null,
  damage: x.dmg ?? 0,
})

/** The whole fight as a BattleState, parsed with the current parser. */
export function realBattleState(): BattleState {
  const esi = JSON.parse(readFileSync(new URL('esi.json', root), 'utf8')) as EsiFixture
  const related = JSON.parse(readFileSync(new URL('related.json', root), 'utf8')) as { kms: RawKm[] }
  const killmails: Killmail[] = related.kms
    .map((k) => ({
      id: k.id,
      hash: k.hash,
      systemId: k.system,
      t: k.time,
      value: k.totalValue,
      victim: participant(k.victim),
      attackers: (k.attackers ?? []).map(participant),
    }))
    .sort((a, b) => a.t - b.t || a.id - b.id)
  const meta: BattleMeta = {
    brId: 'related-31002058-202506221600',
    source: 'br.evetools',
    fetchedAt: 0,
    windows: esi.windows,
    teams: esi.teams,
    killmails,
    names: esi.names,
  }
  const { start, end } = esi.windows[0]!
  const logs: UploadedLog[] = realLogTexts().map(({ file, text }) => {
    const who = esi.listeners.find((l) => l.file === file)
    if (!who) throw new Error(`no listener record for ${file}`)
    const parsed: ParsedLog = parseGamelog(text)
    return {
      id: file,
      charId: who.charId,
      charName: who.charName,
      side: who.side,
      ...(who.corpId ? { corpId: who.corpId, allyId: who.allyId ?? null } : {}),
      uploadedAt: 0,
      parsed: { ...parsed, events: parsed.events.filter((e) => e.t >= start && e.t <= end) },
    }
  })
  return { meta, logs, fits: [], names: esi.nameIndex, sideOverrides: [] }
}

/**
 * The same fight with the real BR the owner generated (br.evetools.org/br/6b03a9aff85099ccb2b7e763, from
 * zkillboard.com/kill/128067622): BR teams instead of the inferred sides. Note: the BR puts L A Z E R H A W K S
 * (Lucinda HIly's alliance) on team 0 although her log shows her repairing team 1 — a real case for log-evidence
 * side correction.
 */
export function realBattleStateWithBr(): BattleState {
  const base = realBattleState()
  const raw = JSON.parse(readFileSync(new URL('br-6b03a9aff85099ccb2b7e763.composition.json', root), 'utf8'))
  const meta = { ...normalizeBrComposition(raw, base.meta.names, 0), windows: base.meta.windows }
  // Re-derive every side from the stored affiliation ids against the BR teams.
  const side = (corpId?: number | null, allyId?: number | null) => (corpId ? sideOf({ corpId, allyId: allyId ?? null }, meta.teams) : -1)
  const logs = base.logs.map((l) => ({ ...l, side: side(l.corpId, l.allyId) }))
  const names: NameIndex = {}
  for (const [k, v] of Object.entries(base.names)) names[k] = v ? { ...v, side: side(v.corpId, v.allyId) } : null
  return { ...base, meta, logs, names }
}
