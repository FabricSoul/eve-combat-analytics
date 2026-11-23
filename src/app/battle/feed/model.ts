import { fmtHms } from '../../lib/format'
import type { EntityKey, InteractionKind, BattleSummary, Analysis, Interaction } from '@/core/contract'

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

/** Latest time the feed may show, and the earliest. */
function bounds(t: number, range: FeedInput['range']): [from: number, to: number] {
  return range ? [range[0], Math.min(t, range[1])] : [-Infinity, t]
}

function inWindow(analysis: Analysis, t: number, kinds: readonly FeedKind[], focus: EntityKey | null | undefined, range: FeedInput['range']) {
  const list: Interaction[] = []
  const [from, to] = bounds(t, range)
  for (const i of analysis.interactions) {
    if (i.t > to) break
    if (i.t < from || i.t <= to - windowMs || !kinds.includes(feedKind(i.kind)) || i.kind === 'miss') continue
    if (focus && i.from !== focus && i.to !== focus) continue
    list.push(i)
  }
  return list
}

function markCurrent(rows: FeedRow[]): FeedRow[] {
  return rows.map((row, index) => ({ ...row, current: index === 0 }))
}

function keyRows({ analysis, summary, t, oursSide, focus, range }: FeedInput): FeedRow[] {
  const rows: FeedRow[] = []
  const [from, to] = bounds(t, range)
  const focusId = focus && /^char:(\d+)$/.test(focus) ? Number(focus.slice(5)) : null
  for (const km of summary.meta.killmails) {
    if (km.t > to || km.t < from) continue
    if (focus && km.victim.charId !== focusId && !km.attackers.some((a) => a.charId === focusId)) continue
    const charId = km.victim.charId
    rows.push({
      id: `kill-${km.id}`, type: 'kill', lastT: km.t, count: 1, total: km.value, kind: 'damage', from: null, to: null,
      weapon: null, victim: charId === null ? null : `char:${charId}`, shipTypeId: km.victim.shipTypeId,
      victimName: charId === null ? null : summary.meta.names[charId]?.name ?? null,
      shipName: km.victim.shipTypeId === null ? null : summary.meta.names[km.victim.shipTypeId]?.name ?? null,
      current: false,
    })
  }
  for (const p of analysis.primaries) {
    if (p.bySide !== oursSide || p.start > to || p.start < from) continue
    if (focus && p.target !== focus && !p.shooters.includes(focus)) continue
    rows.push({
      id: `primary-${p.start}-${p.target}`, type: 'primary', lastT: p.start, count: p.shooters.length, total: 0, kind: 'damage',
      from: null, to: p.target, weapon: null, victim: null, victimName: null, shipTypeId: null, shipName: null, current: false,
    })
  }
  const damages = analysis.interactions.filter((i) => i.kind === 'damage').map((i) => i.amount).sort((a, b) => b - a)
  const threshold = damages[Math.max(1, Math.ceil(damages.length * 0.01)) - 1] ?? Infinity
  for (const i of analysis.interactions) {
    if (i.t > to) break
    if (i.t < from || (focus && i.from !== focus && i.to !== focus)) continue
    if (i.kind === 'damage' && i.amount >= threshold) rows.push(eventRow(i, { type: 'big', id: `big-${i.t}-${i.from}-${i.to}` }))
  }
  return rows.sort((a, b) => b.lastT - a.lastT).slice(0, keyLimit)
}

/** What the event feed shows at playback time t. */
export function buildFeed(input: FeedInput): FeedRow[] {
  const { analysis, mode, t, kinds = defaultFeedKinds, focus, range } = input
  if (mode === 'key') return markCurrent(keyRows(input))
  const list = inWindow(analysis, t, kinds, focus, range)
  if (mode === 'raw') return markCurrent(list.slice(-rawLimit).reverse().map((i, index) => eventRow(i, { id: `${index}-${i.t}-${i.from}-${i.to}-${i.kind}` })))
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
  return markCurrent([...groups.values()].sort((a, b) => b.lastT - a.lastT || b.total - a.total).slice(0, mergedLimit))
}

/** What time span the rows cover, for the feed's header. Key mode is not limited to the last 10 s. */
export function scopeLabel(mode: FeedMode, t: number, range: FeedInput['range']): string {
  const seconds = windowMs / 1000
  if (!range) return mode === 'key' ? `${fmtHms(t)} 之前的关键事件` : `${fmtHms(t)} 之前 ${seconds} 秒`
  const span = `${fmtHms(range[0])}–${fmtHms(Math.min(t, range[1]))} 内`
  return mode === 'key' ? `${span}的关键事件` : `${span} · 最近 ${seconds} 秒`
}
