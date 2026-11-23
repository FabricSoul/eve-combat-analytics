/**
 * Shared contract between the log parser, the BR/ESI ingest, the battle
 * backend (Durable Object), the analysis engine and the UI.
 *
 * Rules that hold everywhere:
 * - Every timestamp is epoch milliseconds, UTC. EVE logs are written in UTC.
 * - `dir: 'out'` means listener → other; `dir: 'in'` means other → listener.
 * - Ids from CCP (characters, corps, alliances, types, systems) are numbers.
 * - Nothing here imports from the browser, Node or the Workers runtime, so
 *   the same code runs in all three.
 *
 * Changing this file is a coordinator decision: workers ask, they do not edit.
 */

// ───────────────────────────── Gamelog parsing ─────────────────────────────

export type ClientLanguage = 'en' | 'zh' | 'unknown'

/** Turret hit quality as printed in English logs; Chinese is mapped onto these. */
export type HitQuality =
  | 'Wrecks'
  | 'Smashes'
  | 'Penetrates'
  | 'Hits'
  | 'Glances Off'
  | 'Grazes'
  /** Missiles, drones and smartbombs print no quality, or one we do not know. */
  | 'none'

/**
 * The other party of a log line, as the listener's overview rendered it.
 * The format depends on the listener's overview ship-label settings, so any
 * field may be missing.
 */
export interface Counterparty {
  /** The text after HTML tags were stripped, trimmed. Always present. */
  raw: string
  /** Pilot name, NPC name or structure name. */
  name: string | null
  corpTicker: string | null
  allianceTicker: string | null
  /** Ship type name as shown, e.g. "Hurricane Fleet Issue" or "勒沙克级". */
  shipType: string | null
  /** CCP type id of the ship, from src/core/data/ship-types.json (en and zh names); null when unknown. */
  shipTypeId: number | null
}

interface EventBase {
  /** Epoch ms UTC of the log line. */
  t: number
  /** 1-based line number in the uploaded file (first physical line of the entry). */
  line: number
  other: Counterparty
}

export interface DamageEvent extends EventBase {
  kind: 'damage'
  dir: 'out' | 'in'
  amount: number
  /** Module, charge or drone name; null when the line prints none. */
  weapon: string | null
  quality: HitQuality
}

export interface MissEvent extends EventBase {
  kind: 'miss'
  dir: 'out' | 'in'
  weapon: string | null
}

export type RepairType = 'armor' | 'shield' | 'hull' | 'capacitor'

export interface RepairEvent extends EventBase {
  kind: 'repair'
  dir: 'out' | 'in'
  repairType: RepairType
  amount: number
  module: string | null
}

export interface CapEvent extends EventBase {
  /** neut = energy neutralized; nos = energy drained (nosferatu). */
  kind: 'neut' | 'nos'
  dir: 'out' | 'in'
  /** GJ, always positive. */
  amount: number
  module: string | null
}

export type EwarType =
  | 'warp_scramble'
  | 'warp_disrupt'
  | 'jam'
  | 'damp'
  | 'web'
  | 'paint'
  | 'tracking_disrupt'
  | 'guidance_disrupt'
  | 'other'

export interface EwarEvent extends EventBase {
  kind: 'ewar'
  dir: 'out' | 'in'
  ewar: EwarType
}

/**
 * Ewar between two other parties that the listener's client reported, e.g.
 * "Warp scramble attempt from Leshak to Bhaalgorn". `source` applies it to `other`.
 */
export interface ObservedEwarEvent extends EventBase {
  kind: 'ewar_seen'
  ewar: EwarType
  source: Counterparty
}

export type LogEvent = DamageEvent | MissEvent | RepairEvent | CapEvent | EwarEvent | ObservedEwarEvent

export interface ParsedLog {
  /** Character name from the "Listener:" / "收听者:" header line. */
  listener: string
  /** Epoch ms UTC from the "Session Started" header. */
  sessionStart: number
  language: ClientLanguage
  /** Sorted by t, then line. */
  events: LogEvent[]
  /** (combat) lines the parser did not understand, kept for diagnostics. */
  unparsed: { line: number; text: string }[]
}

/** Thrown by parseGamelog for input that is not a Gamelog at all. */
export class GamelogFormatError extends Error {
  constructor(
    public readonly code: 'no_header' | 'no_listener' | 'no_session_start',
    message: string,
  ) {
    super(message)
    this.name = 'GamelogFormatError'
  }
}

/** Implemented in src/core/log/parse.ts. */
export type ParseGamelog = (text: string) => ParsedLog

// ───────────────────────────── Battle reports ─────────────────────────────

/** `ally:<id>` or `corp:<id>`; a team is a list of these. */
export type TeamMember = `ally:${number}` | `corp:${number}`

export interface SystemWindow {
  systemId: number
  systemName: string
  regionName: string
  security: number
  start: number
  end: number
}

export interface KillmailParticipant {
  charId: number | null
  corpId: number | null
  allyId: number | null
  shipTypeId: number | null
  /** Attackers only. */
  weaponTypeId: number | null
  /** Victim: damage taken. Attacker: damage done. */
  damage: number
}

export interface Killmail {
  id: number
  hash: string
  systemId: number
  t: number
  /** ISK. */
  value: number
  victim: KillmailParticipant
  attackers: KillmailParticipant[]
}

export interface BattleMeta {
  /**
   * The battle's key everywhere (URLs, Durable Object name): a br.evetools.org BR id (24 hex), or for a
   * system/time "related" link `related-<systemId>-<YYYYMMDDHHMM>`.
   */
  brId: string
  /** `br.evetools.related`: killmails from a related link; teams were inferred from who shot whom. */
  source: 'br.evetools' | 'br.evetools.related'
  fetchedAt: number
  windows: SystemWindow[]
  /** teams[i] is side i. Usually two sides. */
  teams: TeamMember[][]
  killmails: Killmail[]
  /** Names for every id seen in killmails and teams. */
  names: Record<number, { name: string; category: string }>
}

/**
 * Implemented in src/core/br/. Returns the battle key (see BattleMeta.brId) for a BR link, a br.evetools or
 * zkillboard `/related/<systemId>/<YYYYMMDDHHMM>` link, or a bare BR id; null otherwise.
 */
export type ParseBrUrl = (url: string) => string | null
export type NormalizeBrComposition = (raw: unknown, names: BattleMeta['names'], fetchedAt: number) => BattleMeta

// ───────────────────────────── Battle state ─────────────────────────────

export interface Affiliation {
  charId: number
  corpId: number
  allyId: number | null
}

export interface UploadedLog {
  /** sha256 hex of the uploaded text; a re-upload of the same file is a no-op. */
  id: string
  charId: number
  charName: string
  /** Index into BattleMeta.teams, or -1 when the affiliation matches no team. */
  side: number
  /** Affiliation used for `side` (battle-time killmail row when the character is on one, else ESI). Lets manual corp/alliance side overrides reach uploaders who are on no killmail. */
  corpId?: number
  allyId?: number | null
  uploadedAt: number
  /** Only events inside one of the battle's windows. */
  parsed: ParsedLog
}

export interface FitEntry {
  charId: number
  /** EFT text as pasted. */
  eft: string
  setAt: number
}

/** Counterparty display name → resolved character. Filled by the backend via ESI. */
export type NameIndex = Record<string, { charId: number; side: number; corpId?: number; allyId?: number | null } | null>

/** What a side assignment applies to: a whole alliance or corp (as in BR teams) or one character. */
export type SideSubject = TeamMember | `char:${number}`

export interface SideEdit {
  subject: SideSubject
  /** -1 removes the override. 'new' atomically allocates the next side index. */
  side: number | 'new'
}

/**
 * A side assignment that overrides the BR teams (user decision 2026-11-22: manual side editing like br.evetools,
 * plus automatic correction from log evidence). Precedence for a character, highest first: manual char >
 * manual corp/alliance > log evidence > BR team / killmail affiliation > ESI affiliation.
 */
export interface SideOverride {
  subject: SideSubject
  /** BR or override-only side index. An edit response may use -1 for removal. */
  side: number
  /** Only `manual` overrides are stored; `log` ones are derived by analyze() and appear in Analysis.sideOverrides. */
  source: 'manual' | 'log'
  /** For `log`: a short machine-readable reason, e.g. "repaired side 1: 412 events, damaged side 0: 1,205 events". */
  reason?: string
  setAt: number
}

export interface BattleState {
  meta: BattleMeta
  /** Several logs per character are allowed and merged. */
  logs: UploadedLog[]
  fits: FitEntry[]
  names: NameIndex
  /** Manual side overrides, newest last; a later override for the same subject replaces the earlier. */
  sideOverrides: SideOverride[]
}

// ───────────────────────────── HTTP + WebSocket API ─────────────────────────────

export type ApiErrorCode =
  | 'bad_br_url'
  | 'br_not_found'
  | 'br_unavailable'
  | 'not_a_gamelog'
  | 'no_overlap'
  | 'unknown_character'
  | 'bad_eft'
  | 'too_large'
  | 'bad_request'
  /** ESI has no such killmail, or it could not be fetched. */
  | 'killmail_unavailable'

export interface ApiError {
  error: ApiErrorCode
  message: string
}

/**
 * POST /api/battles                 body { brUrl }          → { brId }   (idempotent)
 * GET  /api/battles/:brId                                   → BattleSummary  (no parsed events)
 * GET  /api/battles/:brId/analysis                          → Analysis  (server-computed; ETag "v<analysisVersion>", gzip)
 * GET  /api/battles/:brId/logs/:logId                       → UploadedLog    (immutable: cache forever; for "show source line")
 * POST /api/battles/:brId/logs      body: raw Gamelog text  → UploadedLogSummary
 * PUT  /api/battles/:brId/fits/:charId body: EFT text (≤ 64 KiB) → FitEntry
 * PUT  /api/battles/:brId/sides     body SideEdit            → SideOverride (numeric side in the response)
 * 'new' allocates the next side up to index 7, or returns 400 bad_request when there is no room.
 * GET  /api/battles/:brId/ws        (WebSocket upgrade)     → ServerMessage stream
 * GET  /api/killmails/:id/:hash/fit                         → KillmailFit  (ESI killmail turned into EFT; cache forever)
 *
 * Log uploads are append-only. A character can have several files, and an exact file re-upload is a no-op.
 */
export interface UploadedLogSummary {
  id: string
  charId: number
  charName: string
  side: number
  events: number
  uploadedAt: number
  /** First and last event time in the uploaded log (ms epoch). Optional: summaries stored before 2026-11-23 lack them. */
  first?: number
  last?: number
  language?: ClientLanguage
}

/**
 * The fit a pilot died in, from the ESI killmail, as EFT text ready for PUT /fits/:charId (user decision 2026-11-23:
 * "import from killmail" in the fit tab). Fitted modules, charges, drones and cargo-free; abyssal mutations are not in
 * killmails, so those modules come out as their base type.
 */
export interface KillmailFit {
  killmailId: number
  charId: number | null
  shipTypeId: number
  eft: string
  /**
   * Names (as written in `eft`) of modules that were abyssal/mutated on the killmail and were replaced by their base type,
   * because killmails carry no mutation rolls. Empty when the fit had none; the fit tab warns only when non-empty.
   * Optional: fits cached before 2026-11-23 lack it.
   */
  mutated?: string[]
  /** Type ids on the killmail that the name table does not know (skipped from `eft`). Optional, empty when none. */
  skippedTypeIds?: number[]
}

/**
 * BattleState without parsed events. The server runs analyze() after every change and bumps analysisVersion;
 * clients GET /analysis (user decision 2026-11-22: analysis runs on the server, not in the browser).
 */
export interface BattleSummary {
  meta: BattleMeta
  logs: UploadedLogSummary[]
  fits: FitEntry[]
  names: NameIndex
  sideOverrides: SideOverride[]
  analysisVersion: number
}

/** Every message stays well under 1 MiB: logs are fetched over HTTP, never pushed. */
export type ServerMessage =
  | { type: 'snapshot'; state: BattleSummary }
  /** metaNames contains newly resolved character, corporation, and alliance names keyed by ID. */
  | { type: 'log_added'; log: UploadedLogSummary; names: NameIndex; metaNames?: BattleMeta['names'] }
  | { type: 'fit_set'; fit: FitEntry }
  | { type: 'sides_set'; overrides: SideOverride[] }
  /** A new analysis is ready; clients refetch GET /analysis. */
  | { type: 'analysis_ready'; version: number }

// ───────────────────────────── Analysis ─────────────────────────────

/**
 * `char:<id>` when resolved to a character; `ship:<typeId>:<side>` for a pilot seen only as a ship type
 * (the listener's overview hid the name) that could not be matched to one character; `name:<label>` for
 * NPCs, structures and anything else unresolved.
 */
export type EntityKey = `char:${number}` | `ship:${number}:${number}` | `name:${string}`

export interface Entity {
  key: EntityKey
  name: string
  charId: number | null
  /** -1 when unknown. */
  side: number
  /** Where the side came from (see SideOverride precedence). */
  sideSource: 'manual' | 'log' | 'br' | 'esi' | 'unknown'
  shipTypes: string[]
  hasLog: boolean
}

export type InteractionKind = 'damage' | 'miss' | 'repair' | 'neut' | 'nos' | 'ewar'

export interface Interaction {
  t: number
  from: EntityKey
  to: EntityKey
  kind: InteractionKind
  /** HP, GJ; 0 for miss and ewar. */
  amount: number
  /** Weapon / module, repair type, ewar type, hit quality, as applicable. */
  weapon: string | null
  quality: HitQuality | null
  repairType: RepairType | null
  ewar: EwarType | null
  /** Every log line this interaction was seen in (one or two after dedupe). */
  sources: { logId: string; line: number }[]
  /** Seen in the logs of both parties. */
  corroborated: boolean
}

/** A continuous ewar effect (point, web…) reconstructed from repeated lines. */
export interface EwarSpan {
  from: EntityKey
  to: EntityKey
  ewar: EwarType
  start: number
  end: number
}

export interface PrimaryTarget {
  target: EntityKey
  /** Side doing the shooting. */
  bySide: number
  start: number
  end: number
  /** Killmail time when the target died in this span. */
  killedAt: number | null
  damage: number
  shooters: EntityKey[]
}

export interface PilotStats {
  key: EntityKey
  /** Seconds with any outgoing damage / seconds the pilot was engaged. */
  activeRatio: number
  damageOut: number
  damageIn: number
  repairOut: number
  repairIn: number
  neutOut: number
  neutIn: number
  /** Share of damageOut that landed on the side's primary target of that moment. */
  primaryShare: number
  /** Median seconds from a primary switch to this pilot's first hit on the new primary. */
  switchDelayMedian: number | null
  /** Median seconds from the previous primary's killmail to this pilot's first hit on the next primary (signed). */
  switchAfterKillMedian: number | null
  /** Median seconds from a friendly starting to take damage to this pilot's first rep on them. */
  repReactionMedian: number | null
  /** Seconds from the side's first shot to this pilot's first shot. */
  firstShotDelay: number | null
  hitQuality: Partial<Record<HitQuality, number>>
  misses: number
  pointSeconds: number
  /** From the killmails, for pilots with or without a log. */
  killmailDamage: number
  killmailCount: number
}

export interface Coverage {
  side: number
  /** Distinct characters on killmails or in logs for this side. */
  known: number
  withLog: number
}

export interface Analysis {
  entities: Record<EntityKey, Entity>
  /** Log-evidence side corrections analyze() applied (manual ones are in BattleState.sideOverrides). */
  sideOverrides: SideOverride[]
  /** Deduplicated, sorted by t. */
  interactions: Interaction[]
  ewarSpans: EwarSpan[]
  primaries: PrimaryTarget[]
  stats: PilotStats[]
  coverage: Coverage[]
  /** Per-second buckets from the first to the last interaction. */
  timeline: {
    start: number
    /** side → per-second damage dealt by that side. */
    damageBySide: Record<number, number[]>
  }
}

/** Implemented in src/core/analysis/. Pure: same state in, same analysis out. */
export type Analyze = (state: BattleState) => Analysis

/**
 * Per-pilot stats restricted to [from, to] (ms epoch, inclusive), computed from an already-downloaded Analysis and
 * the battle's killmails. Runs in the browser for the timeline's Shift-drag range (no log download). With the full
 * fight range it returns the same numbers as Analysis.stats.
 */
export type StatsForRange = (analysis: Analysis, killmails: Killmail[], from: number, to: number) => PilotStats[]

// ───────────────────────────── Fit engine (pyfa) ─────────────────────────────

export interface FitStats {
  shipTypeName: string
  dps: { total: number; turret: number; missile: number; drone: number }
  volley: number
  /** Remote repair per second by type. */
  remoteRepair: Partial<Record<RepairType, number>>
  ehp: number
  maxVelocity: number
  /** Weapon ranges in metres, by module name. */
  ranges: Record<string, { optimal: number; falloff: number }>
}

/** Implemented in src/core/fit/ on top of the pyfa engine. */
export type ComputeFitStats = (eft: string) => Promise<FitStats>
