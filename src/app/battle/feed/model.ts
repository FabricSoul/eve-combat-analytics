import { fmtHms } from '../../lib/format'
import type { Analysis, BattleSummary, EntityKey, Interaction, InteractionKind, Killmail, PrimaryTarget } from '@/core/contract'

export type FeedMode = 'merged' | 'raw' | 'key'
export type FeedKind = 'damage' | 'repair' | 'ewar' | 'neut'

export const defaultFeedKinds: readonly FeedKind[] = ['damage', 'repair', 'ewar', 'neut']
export const windowMs = 10_000
const mergedLimit = 16
const rawLimit = 16
const keyLimit = 14

export interface FeedRow {
  /** Row identity for React keys. */
  id: string
  type: 'event' | 'kill' | 'primary' | 'big'
  /** Time of the (last) event, epoch ms. */
  lastT: number
  /** How many raw events the row stands for. */
  count: number
  /** Sum of amounts; the ISK value for kill rows; 0 when the events carry none. */
  total: number
  kind: InteractionKind
  from: EntityKey | null
  to: EntityKey | null
  weapon: string | null
  /** kill rows: the victim. */
  victim: EntityKey | null
  victimName: string | null
  shipTypeId: number | null
  shipName: string | null
  /** The newest row: what playback has just reached. */
  current: boolean
}

export interface FeedInput {
  analysis: Analysis
  summary: BattleSummary
  mode: FeedMode
  /** Playback time, epoch ms. */
  t: number
  oursSide: number
  kinds?: readonly FeedKind[]
  /** Only events with this entity on either end (key mode: kills, switches and hits that involve it). */
  focus?: EntityKey | null
  /** The Shift-drag range: nothing outside it is shown, and the window never runs past its end. */
  range?: readonly [from: number, to: number] | null
}

const feedKind = (kind: InteractionKind): FeedKind => kind === 'nos' ? 'neut' : kind === 'miss' ? 'damage' : kind

function eventRow(i: Interaction, patch: Partial<FeedRow> = {}): FeedRow {
  return {
    id: `${i.t}-${i.from}-${i.to}-${i.kind}`, type: 'event', lastT: i.t, count: 1, total: i.amount, kind: i.kind,
    from: i.from, to: i.to, weapon: i.weapon ?? i.ewar ?? i.repairType, victim: null, victimName: null, shipTypeId: null, shipName: null,
    current: false, ...patch,
  }
}

/** Earliest and latest time the feed may show. */
function bounds(t: number, range: FeedInput['range']): [from: number, to: number] {
  return range ? [range[0], Math.min(t, range[1])] : [-Infinity, t]
}

/** First index in `list` (sorted by `time`) whose time is >= t, or > t when `after`. */
function boundary<T>(list: readonly T[], time: (item: T) => number, t: number, after: boolean): number {
  let low = 0
  let high = list.length
  while (low < high) {
    const mid = (low + high) >>> 1
    const value = time(list[mid]!)
    if (value < t || (after && value === t)) low = mid + 1
    else high = mid
  }
  return low
}
const eventTime = (i: Interaction) => i.t

/** Per-analysis data that does not depend on the cursor: the 1% hit threshold, those hits in time order, primaries by time. */
interface KeyIndex { big: Interaction[]; primaries: PrimaryTarget[] }
const keyIndexes = new WeakMap<Analysis, KeyIndex>()
const killsByTime = new WeakMap<BattleSummary, Killmail[]>()
/** Last merged/raw result per analysis, keyed by the event-index boundaries of the slice and the filters. */
const results = new WeakMap<Analysis, { key: string; rows: FeedRow[] }>()

function keyIndex(analysis: Analysis): KeyIndex {
  let index = keyIndexes.get(analysis)
  if (!index) {
    const damages = analysis.interactions.filter((i) => i.kind === 'damage').map((i) => i.amount).sort((a, b) => b - a)
    const threshold = damages[Math.max(1, Math.ceil(damages.length * 0.01)) - 1] ?? Infinity
    index = {
      big: analysis.interactions.filter((i) => i.kind === 'damage' && i.amount >= threshold),
      primaries: [...analysis.primaries].sort((a, b) => a.start - b.start),
    }
    keyIndexes.set(analysis, index)
  }
  return index
}

function sortedKills(summary: BattleSummary): Killmail[] {
  let kills = killsByTime.get(summary)
  if (!kills) {
    kills = [...summary.meta.killmails].sort((a, b) => a.t - b.t)
    killsByTime.set(summary, kills)
  }
  return kills
}

/** The newest `limit` items of a time-sorted list inside [from, to] that pass `keep`, newest first. */
function newest<T>(list: readonly T[], time: (item: T) => number, from: number, to: number, keep: (item: T) => boolean, limit: number): T[] {
  const out: T[] = []
  const first = boundary(list, time, from, false)
  for (let i = boundary(list, time, to, true) - 1; i >= first && out.length < limit; i--) {
    if (keep(list[i]!)) out.push(list[i]!)
  }
  return out
}

function keyRows({ analysis, summary, t, oursSide, focus, range }: FeedInput): FeedRow[] {
  const [from, to] = bounds(t, range)
  const focusId = focus && /^char:(\d+)$/.test(focus) ? Number(focus.slice(5)) : null
  const { big, primaries } = keyIndex(analysis)
  const rows: FeedRow[] = []
  for (const km of newest(sortedKills(summary), (k) => k.t, from, to,
    (k) => !focus || k.victim.charId === focusId || k.attackers.some((a) => a.charId === focusId), keyLimit)) {
    const charId = km.victim.charId
    rows.push({
      id: `kill-${km.id}`, type: 'kill', lastT: km.t, count: 1, total: km.value, kind: 'damage', from: null, to: null,
      weapon: null, victim: charId === null ? null : `char:${charId}`, shipTypeId: km.victim.shipTypeId,
      victimName: charId === null ? null : summary.meta.names[charId]?.name ?? null,
      shipName: km.victim.shipTypeId === null ? null : summary.meta.names[km.victim.shipTypeId]?.name ?? null,
      current: false,
    })
  }
  for (const p of newest(primaries, (x) => x.start, from, to,
    (x) => x.bySide === oursSide && (!focus || x.target === focus || x.shooters.includes(focus)), keyLimit)) {
    rows.push({
      id: `primary-${p.start}-${p.target}`, type: 'primary', lastT: p.start, count: p.shooters.length, total: 0, kind: 'damage',
      from: null, to: p.target, weapon: null, victim: null, victimName: null, shipTypeId: null, shipName: null, current: false,
    })
  }
  for (const i of newest(big, eventTime, from, to, (x) => !focus || x.from === focus || x.to === focus, keyLimit)) {
    rows.push(eventRow(i, { type: 'big', id: `big-${i.t}-${i.from}-${i.to}` }))
  }
  return rows.sort((a, b) => b.lastT - a.lastT).slice(0, keyLimit)
}

function markCurrent(rows: FeedRow[]): FeedRow[] {
  return rows.map((row, index) => ({ ...row, current: index === 0 }))
}

/** What the event feed shows at playback time t. */
export function buildFeed(input: FeedInput): FeedRow[] {
  const { analysis, mode, t, kinds = defaultFeedKinds, focus, range } = input
  if (mode === 'key') return markCurrent(keyRows(input))
  const { interactions } = analysis
  const [from, to] = bounds(t, range)
  const low = Math.max(boundary(interactions, eventTime, to - windowMs, true), boundary(interactions, eventTime, from, false))
  const high = boundary(interactions, eventTime, to, true)
  const key = `${mode}|${low}|${high}|${kinds.join()}|${focus ?? ''}`
  const cached = results.get(analysis)
  if (cached?.key === key) return cached.rows

  const wanted = new Set(kinds)
  const list: Interaction[] = []
  for (let n = low; n < high; n++) {
    const i = interactions[n]!
    if (!wanted.has(feedKind(i.kind))) continue
    if (focus && i.from !== focus && i.to !== focus) continue
    list.push(i)
  }
  let rows: FeedRow[]
  if (mode === 'raw') {
    rows = markCurrent(list.slice(-rawLimit).reverse().map((i, index) => eventRow(i, { id: `${index}-${i.t}-${i.from}-${i.to}-${i.kind}` })))
  } else {
    const groups = new Map<string, FeedRow>()
    for (const i of list) {
      const id = `${i.from}-${i.to}-${i.kind}`
      const group = groups.get(id)
      if (group) {
        group.count++
        group.total += i.amount
        group.lastT = i.t
        group.weapon = i.weapon ?? i.ewar ?? i.repairType ?? group.weapon
      } else groups.set(id, eventRow(i, { id }))
    }
    rows = markCurrent([...groups.values()].sort((a, b) => b.lastT - a.lastT || b.total - a.total).slice(0, mergedLimit))
  }
  results.set(analysis, { key, rows })
  return rows
}

/** What time span the rows cover, for the feed's header. Key mode is not limited to the last 10 s. */
export function scopeLabel(mode: FeedMode, t: number, range: FeedInput['range']): string {
  const seconds = windowMs / 1000
  if (!range) return mode === 'key' ? `${fmtHms(t)} 之前的关键事件` : `${fmtHms(t)} 之前 ${seconds} 秒`
  const span = `${fmtHms(range[0])}–${fmtHms(Math.min(t, range[1]))} 内`
  return mode === 'key' ? `${span}的关键事件` : `${span} · 最近 ${seconds} 秒`
}
