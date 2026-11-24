import type { Entity, EntityKey, Interaction } from '@/core/contract'
import { itemTypeId } from '@/core/data/item-types'
import { fmtNum, fmtPct } from '../../lib/format'
import { hitOutcome, type HitCounts, type HitOutcome } from '../compare/hit-quality'
import classIds from './weapon-classes.json'

export const MIN_RANKED_SHOTS = 30
export const HIT_MINUTE = 60_000
export const hitObservationHint = '只统计有命中质量或明确未命中的记录，略过无质量的立体炸弹等效果。敌方数据仅覆盖对我方日志上传者的射击。'
export const classLabels = { turret: '炮台', missile: '导弹', drone: '无人机', other: '其他 / 未识别' } as const
export type WeaponClass = keyof typeof classLabels

const classById = new Map([
  ...classIds.turret.map((id) => [id, 'turret'] as const),
  ...classIds.missile.map((id) => [id, 'missile'] as const),
  ...classIds.drone.map((id) => [id, 'drone'] as const),
])

export interface ShotCounts extends HitCounts {
  shots: number
  hits: number
  damage: number
}

interface CombatHits extends ShotCounts { classes: Map<WeaponClass, ShotCounts> }

export interface PilotHits extends CombatHits {
  entity: Entity
  weapons: Map<string, ShotCounts>
}

interface SideHits extends CombatHits { minutes: Map<number, ShotCounts> }

const emptyCounts = (): ShotCounts => ({ shots: 0, hits: 0, damage: 0, hitQuality: {}, misses: 0 })
const emptyCombat = (): CombatHits => ({ ...emptyCounts(), classes: new Map() })

function entry<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key)
  if (existing) return existing
  const value = create()
  map.set(key, value)
  return value
}

function record(counts: ShotCounts, outcome: HitOutcome, amount: number) {
  counts.shots++
  if (outcome === 'miss') counts.misses++
  else {
    counts.hits++
    counts.damage += amount
    counts.hitQuality[outcome] = (counts.hitQuality[outcome] ?? 0) + 1
  }
}

export function aggregateHits(
  entities: Readonly<Record<EntityKey, Entity>>,
  interactions: readonly Interaction[],
  uploaders: ReadonlySet<EntityKey>,
  ours: number,
  range?: readonly [number, number] | null,
) {
  const pilots = new Map<EntityKey, PilotHits>()
  const sides = new Map<number, SideHits>()
  const classes = new Map<string, WeaponClass>()
  for (const entity of Object.values(entities)) {
    if (entity.charId !== null) pilots.set(entity.key, { entity, ...emptyCombat(), weapons: new Map() })
  }
  for (const event of interactions) {
    if (range && (event.t < range[0] || event.t > range[1])) continue
    const source = entities[event.from]
    if (!source || (source.side !== ours && !(uploaders.has(event.to) && entities[event.to]?.side === ours))) continue
    const outcome = hitOutcome(event)
    if (outcome === null) continue
    const weapon = event.weapon ?? '未记录武器'
    const weaponClass = entry(classes, weapon, () => classById.get(itemTypeId(weapon) ?? -1) ?? 'other')
    const side = entry(sides, source.side, () => ({ ...emptyCombat(), minutes: new Map() }))
    record(side, outcome, event.amount)
    record(entry(side.classes, weaponClass, emptyCounts), outcome, event.amount)
    record(entry(side.minutes, Math.floor(event.t / HIT_MINUTE) * HIT_MINUTE, emptyCounts), outcome, event.amount)
    const pilot = pilots.get(source.key)
    if (!pilot) continue
    record(pilot, outcome, event.amount)
    record(entry(pilot.classes, weaponClass, emptyCounts), outcome, event.amount)
    record(entry(pilot.weapons, weapon, emptyCounts), outcome, event.amount)
  }
  return { pilots, sides }
}

const ratio = (shots: number, total: number) => total ? shots / total : null
const average = (damage: number | null) => fmtNum(damage === null ? null : Math.round(damage * 10) / 10)
export const hitMetrics = {
  hitRate: { label: '命中率', direction: 'descending', format: fmtPct, value: (counts: ShotCounts) => ratio(counts.hits, counts.shots) },
  strongShare: { label: '致命一击 + 强力一击占比', direction: 'descending', format: fmtPct,
    value: (counts: ShotCounts) => ratio((counts.hitQuality.Wrecks ?? 0) + (counts.hitQuality.Smashes ?? 0), counts.shots) },
  missRate: { label: '未命中率', direction: 'ascending', format: fmtPct, value: (counts: ShotCounts) => ratio(counts.misses, counts.shots) },
  damagePerShot: { label: '每发平均伤害', direction: 'descending', format: average, value: (counts: ShotCounts) => ratio(counts.damage, counts.shots) },
} as const
export type HitMetric = keyof typeof hitMetrics
export const hitMetricKeys = Object.keys(hitMetrics) as HitMetric[]

export function rankPilots(pilots: Iterable<PilotHits>, metric: HitMetric) {
  const definition = hitMetrics[metric]
  const direction = definition.direction === 'ascending' ? 1 : -1
  const ranked: { pilot: PilotHits; value: number; rank: number }[] = []
  const insufficient: PilotHits[] = []
  for (const pilot of pilots) {
    if (pilot.shots < MIN_RANKED_SHOTS) insufficient.push(pilot)
    else ranked.push({ pilot, value: definition.value(pilot)!, rank: 0 })
  }
  ranked.sort((a, b) => direction * (a.value - b.value) || a.pilot.entity.name.localeCompare(b.pilot.entity.name))
  ranked.forEach((row, index) => {
    const previous = ranked[index - 1]
    row.rank = previous?.value === row.value ? previous.rank : index + 1
  })
  insufficient.sort((a, b) => b.shots - a.shots || a.entity.name.localeCompare(b.entity.name))
  return { ranked, insufficient }
}

export function weaponRows(pilot: PilotHits) {
  return [...pilot.weapons].sort(([a, first], [b, second]) => second.shots - first.shots || a.localeCompare(b))
}
