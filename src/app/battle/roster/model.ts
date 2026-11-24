import type { Analysis, BattleSummary, Entity, EntityKey, PilotStats } from '@/core/contract'
import { fmtHms } from '../../lib/format'
import { sideOrder } from '../../lib/sides'
import { sideIndexOf } from './affiliation'
import { shipNameById, shipTypeIdByName } from './ships'

export interface RosterTag {
  kind: 'log' | 'manual' | 'merge'
  /** Hover text: the evidence for 据日志, the change time for 手动 and 合并. */
  title: string
}

export interface RosterRow {
  key: EntityKey
  /** null for pilots the overview hid (ship:) or we could not resolve (name:): no portrait, no side override. */
  charId: number | null
  name: string
  side: number
  hasLog: boolean
  /** No log of his own, but our logs saw him: his numbers are a lower bound. */
  observed: boolean
  dead: boolean
  ship: string | null
  shipTypeId: number | null
  tag: RosterTag | null
}

export interface RosterGroup {
  side: number
  rows: RosterRow[]
  withLog: number
}

const numerals = ['', '', '', '三', '四', '五', '六', '七', '八', '九', '十']

/** 我方 · 敌方 · 第三方 …; `order` is sideOrder(): ours first. */
export function sideName(side: number, order: readonly number[]): string {
  if (side < 0) return '未分边'
  const index = order.indexOf(side)
  if (index === 0) return '我方'
  if (index === 1) return '敌方'
  return `第${numerals[index + 1] ?? index + 1}方`
}

/** sideOrder() plus any side that has people but no coverage row, by side number. */
export function fullSideOrder(analysis: Analysis, oursSide: number): number[] {
  const order = sideOrder(analysis, oursSide)
  const extra = new Set<number>()
  for (const entity of Object.values(analysis.entities)) {
    if (entity.side >= 0 && !order.includes(entity.side)) extra.add(entity.side)
  }
  return [...order, ...[...extra].sort((a, b) => a - b)]
}

function tagOf(entity: Entity, charId: number, summary: BattleSummary, analysis: Analysis): RosterTag | null {
  const merges = (summary.identityMerges ?? []).filter(({ to }) => to === `char:${charId}`)
  if (merges.length) return { kind: 'merge', title: `合并 · ${merges.map(({ setAt }) => new Date(setAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC').join('、')} 设` }
  if (entity.sideSource === 'log') {
    const override = analysis.sideOverrides.find(({ subject }) => subject === `char:${charId}`)
    return { kind: 'log', title: override?.reason ?? '据日志修正' }
  }
  if (entity.sideSource === 'manual') {
    const override = sideIndexOf(summary).manualOverrides.get(charId)
    return { kind: 'manual', title: override ? `手动 · ${fmtHms(override.setAt).slice(0, 5)} 改` : '手动' }
  }
  return null
}

interface Sighting { t: number; dead: boolean; shipTypeId: number | null }

/** Killmail appearances per character, time-ordered; at a tie the survivor comes before the death. */
const sightings = new WeakMap<BattleSummary, Map<number, Sighting[]>>()
/** When each entity acted in the logs (the `from` side of an interaction), time-ordered. */
const actedAt = new WeakMap<Analysis, Map<EntityKey, number[]>>()
/** A death is only cleared by log activity this long after it: the dying ship's last lines share its second. */
const reappearAfterMs = 5_000

function sightingsOf(summary: BattleSummary, charId: number): Sighting[] {
  let all = sightings.get(summary)
  if (!all) {
    all = new Map()
    const add = (id: number | null, sighting: Sighting) => {
      if (id !== null) all!.set(id, [...all!.get(id) ?? [], sighting])
    }
    for (const km of summary.meta.killmails) {
      add(km.victim.charId, { t: km.t, dead: true, shipTypeId: km.victim.shipTypeId })
      for (const a of km.attackers) add(a.charId, { t: km.t, dead: false, shipTypeId: a.shipTypeId })
    }
    for (const list of all.values()) list.sort((a, b) => a.t - b.t || Number(a.dead) - Number(b.dead))
    sightings.set(summary, all)
  }
  return all.get(charId) ?? []
}

function actedTimes(analysis: Analysis, key: EntityKey): number[] {
  let all = actedAt.get(analysis)
  if (!all) {
    all = new Map()
    for (const i of analysis.interactions) {
      const times = all.get(i.from)
      if (times) times.push(i.t)
      else all.set(i.from, [i.t])
    }
    actedAt.set(analysis, all)
  }
  return all.get(key) ?? []
}

/** Death and ship at `at` from time-ordered evidence: the latest killmail sighting rules, log activity after a death clears it. */
function stateAt(summary: BattleSummary, analysis: Analysis, entity: Entity, charId: number, at: number) {
  let last: Sighting | undefined
  for (const sighting of sightingsOf(summary, charId)) {
    if (sighting.t > at) break
    last = sighting
  }
  let dead = last?.dead ?? false
  if (last && dead) {
    const after = last.t + reappearAfterMs
    dead = !actedTimes(analysis, entity.key).some((t) => t > after && t <= at)
  }
  return { dead, shipTypeId: last?.shipTypeId ?? null }
}

/**
 * Roster groups: our side first (pilots with logs, then the rest), then each other side by population, then 未分边.
 * `at` limits who counts as dead to killmails up to that time; `stats` orders them (the Shift-drag range's, else the whole fight's). Inside a group: character rows first (ours: with logs first), then ship:/name: rows, each by damage output.
 */
export function buildRoster(
  summary: BattleSummary, analysis: Analysis, oursSide: number, at = Infinity, stats: readonly PilotStats[] = analysis.stats,
): RosterGroup[] {
  const output = new Map(stats.map((stats) => [stats.key, [stats.damageOut, stats.killmailDamage] as const]))
  const bySide = new Map<number, RosterRow[]>()
  const observed = new Set(analysis.stats.filter((entry) => entry.source === 'observed').map((entry) => entry.key))

  const merged = new Set((summary.identityMerges ?? []).map(({ from }) => from))
  for (const entity of Object.values(analysis.entities)) {
    const { charId } = entity
    if (merged.has(entity.key)) continue
    const state = charId === null ? null : stateAt(summary, analysis, entity, charId, at)
    const keyType = /^ship:(\d+):/.exec(entity.key)?.[1]
    const sighted = state?.shipTypeId ?? null
    const seenName = sighted === null ? null : summary.meta.names[sighted]?.name ?? shipNameById(sighted)
    // A ship type we cannot name is not shown: the entity's own ship stands in.
    const seenType = seenName === null ? null : sighted
    const ship = seenName ?? entity.shipTypes[0] ?? null
    const row: RosterRow = {
      key: entity.key, charId, name: entity.name, side: entity.side, hasLog: entity.hasLog, observed: !entity.hasLog && observed.has(entity.key),
      dead: state?.dead ?? false, ship,
      shipTypeId: seenType ?? (keyType ? Number(keyType) : shipTypeIdByName(ship)),
      tag: charId === null ? null : tagOf(entity, charId, summary, analysis),
    }
    bySide.set(entity.side, [...bySide.get(entity.side) ?? [], row])
  }

  const rank = (row: RosterRow) => output.get(row.key) ?? [0, 0]
  const byOutput = (a: RosterRow, b: RosterRow) =>
    Number(a.charId === null) - Number(b.charId === null) || rank(b)[0] - rank(a)[0] || rank(b)[1] - rank(a)[1] || a.name.localeCompare(b.name)
  const sides = [...fullSideOrder(analysis, oursSide), -1]
  return sides.flatMap((side) => {
    const rows = (bySide.get(side) ?? []).sort(side === oursSide
      ? (a, b) => Number(a.charId === null) - Number(b.charId === null) || Number(b.hasLog) - Number(a.hasLog) || byOutput(a, b)
      : byOutput)
    return rows.length === 0 ? [] : [{ side, rows, withLog: rows.filter((row) => row.hasLog).length }]
  })
}
