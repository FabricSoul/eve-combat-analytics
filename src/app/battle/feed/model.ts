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
  /** Only events with this entity on either end. */
  focus?: EntityKey | null
}

const feedKind = (kind: InteractionKind): FeedKind => kind === 'nos' ? 'neut' : kind === 'miss' ? 'damage' : kind

function eventRow(i: Interaction, patch: Partial<FeedRow> = {}): FeedRow {
  return {
    id: `${i.t}-${i.from}-${i.to}-${i.kind}`, type: 'event', lastT: i.t, count: 1, total: i.amount, kind: i.kind,
    from: i.from, to: i.to, weapon: i.weapon ?? i.ewar ?? i.repairType, victim: null, victimName: null, shipTypeId: null, shipName: null,
    current: false, ...patch,
  }
}

function inWindow(analysis: Analysis, t: number, kinds: readonly FeedKind[], focus: EntityKey | null | undefined) {
  const list: Interaction[] = []
  for (const i of analysis.interactions) {
    if (i.t > t) break
    if (i.t <= t - windowMs || !kinds.includes(feedKind(i.kind)) || i.kind === 'miss') continue
    if (focus && i.from !== focus && i.to !== focus) continue
    list.push(i)
  }
  return list
}

function markCurrent(rows: FeedRow[]): FeedRow[] {
  return rows.map((row, index) => ({ ...row, current: index === 0 }))
}

function keyRows({ analysis, summary, t, oursSide }: FeedInput): FeedRow[] {
  const rows: FeedRow[] = []
  for (const km of summary.meta.killmails) {
    if (km.t > t) continue
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
    if (p.bySide !== oursSide || p.start > t) continue
    rows.push({
      id: `primary-${p.start}-${p.target}`, type: 'primary', lastT: p.start, count: p.shooters.length, total: 0, kind: 'damage',
      from: null, to: p.target, weapon: null, victim: null, victimName: null, shipTypeId: null, shipName: null, current: false,
    })
  }
  const damages = analysis.interactions.filter((i) => i.kind === 'damage').map((i) => i.amount).sort((a, b) => b - a)
  const threshold = damages[Math.max(1, Math.ceil(damages.length * 0.01)) - 1] ?? Infinity
  for (const i of analysis.interactions) {
    if (i.t > t) break
    if (i.kind === 'damage' && i.amount >= threshold) rows.push(eventRow(i, { type: 'big', id: `big-${i.t}-${i.from}-${i.to}` }))
  }
  return rows.sort((a, b) => b.lastT - a.lastT).slice(0, keyLimit)
}

/** What the event feed shows at playback time t. */
export function buildFeed(input: FeedInput): FeedRow[] {
  const { analysis, mode, t, kinds = defaultFeedKinds, focus } = input
  if (mode === 'key') return markCurrent(keyRows(input))
  const list = inWindow(analysis, t, kinds, focus)
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
