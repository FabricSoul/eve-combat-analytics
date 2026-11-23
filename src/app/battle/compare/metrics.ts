import { useMemo } from 'react'
import { statsForRange } from '@/core/analysis/range'
import type { Entity, EntityKey, Interaction, PilotStats } from '@/core/contract'
import { parseEft } from '@/fit/eft'
import shipTypes from '@/core/data/ship-types.json'
import { fmtNum, fmtPct, fmtSec } from '../../lib/format'
import { useBattleContext } from '../../state/battle-store'
import { useView } from '../../state/view-store'
import damageTypes from './damage-types.json'
import em from './em_small.png'
import explosive from './explosive_small.png'
import kinetic from './kinetic_small.png'
import thermal from './thermal_small.png'

export const damageKinds = {
  em: { label: '电磁', icon: em },
  thermal: { label: '热能', icon: thermal },
  kinetic: { label: '动能', icon: kinetic },
  explosive: { label: '爆炸', icon: explosive },
  unknown: { label: '未知类型', icon: undefined },
} as const
export type DamageKind = keyof typeof damageKinds
export type DamageBreakdown = Partial<Record<DamageKind, number>>
export const unknownDamageReason = '日志没有可辨认的单一伤害类型。炮台需要配装中的弹药，混合伤害无法从日志拆分。'

const directDamage: Readonly<Record<string, string>> = damageTypes
const ships = new Map(shipTypes.flatMap(({ en, zh, id }) => [[en, id] as const, [zh, id] as const]))
export function shipId(entity: Entity): number | null {
  const shipKey = /^ship:(\d+):/.exec(entity.key)
  if (shipKey) return Number(shipKey[1])
  return entity.shipTypes.flatMap((name) => ships.get(name) ?? [])[0] ?? null
}

export function sideLabel(side: number, ours: number, order: readonly number[]): string {
  if (side < 0) return '未分边'
  if (side === ours) return '我方'
  if (order.length === 2) return '敌方'
  return `第 ${order.indexOf(side) + 1} 方`
}

type Group = '输出' | '节奏' | '承伤' | '后勤' | '点控'
type NumericKey = Exclude<keyof PilotStats, 'key' | 'hitQuality'>

export interface Metric {
  key: NumericKey | DamageKind
  label: string
  group: Group
  format: (value: number | null) => string
  reason?: string
  battleReport?: boolean
}

const amount = (value: number | null) => fmtNum(value === null ? null : Math.round(value))
export const seconds = (value: number | null) => fmtSec(value).replace(/ s$/, ' 秒')

export const metrics = [
  { key: 'damageOut', label: '输出', group: '输出', format: amount },
  { key: 'killmailDamage', label: '击毁报告伤害', group: '输出', format: amount, battleReport: true },
  { key: 'activeRatio', label: '开火在线', group: '节奏', format: fmtPct },
  { key: 'primaryShare', label: '集火率', group: '节奏', format: fmtPct },
  { key: 'switchDelayMedian', label: '切目标', group: '节奏', format: seconds, reason: '这段时间没有本方主目标切换，或他没打到新目标' },
  { key: 'switchAfterKillMedian', label: '目标死后转火', group: '节奏', format: seconds, reason: '没有带击毁记录的前一个主目标，或他没打到下一个主目标' },
  { key: 'firstShotDelay', label: '首枪', group: '节奏', format: seconds, reason: '这段时间没有可用于比较的首枪' },
  { key: 'damageIn', label: '承伤', group: '承伤', format: amount },
  ...Object.entries(damageKinds).map(([key, { label }]): Metric => ({
    key: key as DamageKind, label, group: '承伤', format: amount,
  })),
  { key: 'repairIn', label: '被修', group: '承伤', format: amount },
  { key: 'repairOut', label: '维修输出', group: '后勤', format: amount },
  { key: 'repReactionMedian', label: '维修反应', group: '后勤', format: seconds, reason: '他没修过队友，或被修的人没有可对应的掉血记录' },
  { key: 'pointSeconds', label: '点控时长', group: '点控', format: seconds },
  { key: 'neutOut', label: '中和输出', group: '点控', format: amount },
  { key: 'neutIn', label: '被中和', group: '点控', format: amount },
] satisfies readonly Metric[]

export const defaultColumns = [
  'damageOut', 'activeRatio', 'primaryShare', 'switchDelayMedian', 'switchAfterKillMedian', 'damageIn',
  'repairOut', 'repReactionMedian', 'pointSeconds',
] satisfies Metric['key'][]

export interface CompareRow {
  entity: Entity
  stats: PilotStats
  damage?: DamageBreakdown
}

function isDamageKind(key: Metric['key']): key is DamageKind {
  return Object.hasOwn(damageKinds, key)
}

export function metricValue(row: CompareRow, metric: Metric): number | null {
  if (!row.entity.hasLog && !metric.battleReport) return null
  if (isDamageKind(metric.key)) return row.damage?.[metric.key] ?? 0
  if (metric.battleReport && row.stats.killmailCount === 0) return null
  if (metric.key === 'primaryShare' && row.stats.damageOut === 0) return null
  return row.stats[metric.key]
}

export function missingReason(row: CompareRow, metric: Metric): string {
  if (metric.battleReport) return '这段时间没有他的击毁报告'
  if (!row.entity.hasLog) return '没有上传他的战斗日志'
  if (metric.key === 'primaryShare') return '这段时间没有输出'
  return metric.reason ?? '这段时间没有可用数据'
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return values.length % 2 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2
}

export function rowMedian(rows: readonly CompareRow[], metric: Metric) {
  return median(rows.flatMap((row) => metricValue(row, metric) ?? []))
}

export function useCombatRows() {
  const { analysis, summary } = useBattleContext()
  const { range } = useView()
  return useMemo(() => {
    if (!analysis || !summary) return { rows: [], interactions: [] }
    const interactions = range
      ? analysis.interactions.filter(({ t }) => t >= range[0] && t <= range[1])
      : analysis.interactions
    const stats = range ? statsForRange(analysis, summary.meta.killmails, ...range) : analysis.stats
    const ammo = new Map<EntityKey, Map<string, Set<string | undefined>>>()
    for (const { charId, eft } of summary.fits) {
      try {
        const weapons = new Map<string, Set<string | undefined>>()
        for (const { name, charge, offline } of parseEft(eft).modules) {
          if (offline) continue
          const charges = weapons.get(name) ?? new Set()
          charges.add(charge)
          weapons.set(name, charges)
        }
        ammo.set(`char:${charId}`, weapons)
      } catch {
        // An old or partial fit provides no charge evidence.
      }
    }
    const damage = new Map<EntityKey, DamageBreakdown>()
    for (const event of interactions) {
      if (event.kind !== 'damage' || !analysis.entities[event.to]?.hasLog) continue
      const kind = damageKind(event, ammo.get(event.from))
      const totals = damage.get(event.to) ?? {}
      totals[kind] = (totals[kind] ?? 0) + event.amount
      damage.set(event.to, totals)
    }
    const rows = stats.flatMap((entry): CompareRow[] => {
      const entity = analysis.entities[entry.key]
      return entity ? [{ entity, stats: entry, damage: damage.get(entry.key) }] : []
    })
    return { rows, interactions }
  }, [analysis, summary, range])
}

function damageKind({ weapon }: Interaction, ammo?: Map<string, Set<string | undefined>>): DamageKind {
  if (!weapon) return 'unknown'
  const direct = Object.hasOwn(directDamage, weapon) ? directDamage[weapon] : undefined
  if (direct) return direct as DamageKind
  const charges = ammo?.get(weapon)
  if (charges?.size !== 1) return 'unknown'
  const charge = charges.values().next().value
  return charge && Object.hasOwn(directDamage, charge) ? directDamage[charge] as DamageKind : 'unknown'
}
