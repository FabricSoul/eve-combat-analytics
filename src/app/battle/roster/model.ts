import type { Analysis, BattleSummary, Entity, EntityKey, PilotStats, SideOverride } from '@/core/contract'
import { fmtHms } from '../../lib/format'
import { sideOrder } from '../../lib/sides'
import { affiliationOf } from './affiliation'
import { shipTypeIdByName } from './ships'

export interface RosterTag {
  kind: 'log' | 'manual'
  /** Hover text: the evidence for 据日志, the change time for 手动. */
  title: string
}

export interface RosterRow {
  key: EntityKey
  /** null for pilots the overview hid (ship:) or we could not resolve (name:): no portrait, no side override. */
  charId: number | null
  name: string
  side: number
  hasLog: boolean
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

function overrideSubjects(summary: BattleSummary, charId: number): string[] {
  const affiliation = affiliationOf(summary, charId)
  return [
    `char:${charId}`,
    ...(affiliation ? [`corp:${affiliation.corpId}`] : []),
    ...(affiliation?.allyId != null ? [`ally:${affiliation.allyId}`] : []),
  ]
}

function findOverride(overrides: readonly SideOverride[], subjects: readonly string[]): SideOverride | undefined {
  for (const subject of subjects) {
    const found = [...overrides].reverse().find((override) => override.subject === subject)
    if (found) return found
  }
  return undefined
}

function tagOf(entity: Entity, charId: number, summary: BattleSummary, analysis: Analysis): RosterTag | null {
  if (entity.sideSource === 'log') {
    const override = findOverride(analysis.sideOverrides, overrideSubjects(summary, charId))
    return { kind: 'log', title: override?.reason ?? '据日志修正' }
  }
  if (entity.sideSource === 'manual') {
    const override = findOverride(summary.sideOverrides, overrideSubjects(summary, charId))
    return { kind: 'manual', title: override ? `手动 · ${fmtHms(override.setAt).slice(0, 5)} 改` : '手动' }
  }
  return null
}

/**
 * Roster groups: our side first (pilots with logs, then the rest), then each other side by population, then 未分边.
 * `at` limits who counts as dead to killmails up to that time; `stats` orders them (the Shift-drag range's, else the whole fight's). Inside a group: character rows first (ours: with logs first), then ship:/name: rows, each by damage output.
 */
export function buildRoster(
  summary: BattleSummary, analysis: Analysis, oursSide: number, at = Infinity, stats: readonly PilotStats[] = analysis.stats,
): RosterGroup[] {
  // Dead from the first killmail where they are the victim; `at` is the replay cursor (range end while a range is set).
  const dead = new Set(summary.meta.killmails.flatMap(({ victim, t }) => victim.charId === null || t > at ? [] : [victim.charId]))
  const output = new Map(stats.map((stats) => [stats.key, [stats.damageOut, stats.killmailDamage] as const]))
  const bySide = new Map<number, RosterRow[]>()

  for (const entity of Object.values(analysis.entities)) {
    const ship = entity.shipTypes[0] ?? null
    const { charId } = entity
    const keyType = /^ship:(\d+):/.exec(entity.key)?.[1]
    const row: RosterRow = {
      key: entity.key, charId, name: entity.name, side: entity.side, hasLog: entity.hasLog,
      dead: charId !== null && dead.has(charId), ship,
      shipTypeId: keyType ? Number(keyType) : shipTypeIdByName(ship),
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
