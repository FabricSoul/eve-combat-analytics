import type { Entity, EntityKey, Interaction } from '@/core/contract'
import { fmtNum, fmtPct } from '../../lib/format'
import { hitOutcome, type HitCounts, type HitOutcome } from '../compare/hit-quality'
import classNames from './weapon-classes.json'

export const MIN_RANKED_SHOTS = 30
export const HIT_MINUTE = 60_000
export const hitObservationHint = '命中率和排名样本只统计有质量的命中和明确未命中。立体炸弹、分裂者舱等无质量伤害另计。敌方未上传日志的飞行员仅统计对我方日志上传者的射击。上传者的射击在所有视角均计入。'
export const classLabels = { turret: '炮台', missile: '导弹', drone: '无人机 / 铁骑舰载机', smartbomb: '立体炸弹', other: '其他 / 未识别' } as const
export type WeaponClass = keyof typeof classLabels

type CatalogWeapon = keyof typeof classNames
const classByName = new Map(
  (Object.keys(classNames) as CatalogWeapon[]).flatMap((kind) => classNames[kind].map((name) => [name, kind] as const)),
)

export function classifyWeapon(name: string): CatalogWeapon | 'other' {
  const key = name.trim().replace(/\*+$/, '').trim().toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"')
  return classByName.get(key) ?? 'other'
}

// These weapon groups print generic Hits for damage that has no hit-quality roll.
export const isUngradedWeapon = (kind: CatalogWeapon | 'other') => kind === 'breacher' || kind === 'smartbomb'

export interface ShotCounts extends HitCounts {
  shots: number
  ungraded: number
  hits: number
  damage: number
}

interface CombatHits extends ShotCounts { classes: Map<WeaponClass, ShotCounts> }

export interface PilotHits extends CombatHits {
  entity: Entity
  weapons: Map<string, ShotCounts>
}

interface SideHits extends CombatHits { minutes: Map<number, ShotCounts> }

const emptyCounts = (): ShotCounts => ({ shots: 0, ungraded: 0, hits: 0, damage: 0, hitQuality: {}, misses: 0 })
const emptyCombat = (): CombatHits => ({ ...emptyCounts(), classes: new Map() })

function entry<K, V>(map: Map<K, V>, key: K, create: () => V): V {
  const existing = map.get(key)
  if (existing) return existing
  const value = create()
  map.set(key, value)
  return value
}

function record(counts: ShotCounts, outcome: HitOutcome | null, amount: number) {
  if (outcome === null) {
    counts.ungraded++
    return
  }
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
  const unidentified = new Map<EntityKey, PilotHits>()
  const sides = new Map<number, SideHits>()
  const classes = new Map<string, CatalogWeapon | 'other'>()
  for (const entity of Object.values(entities)) {
    const observations = entity.charId === null ? unidentified : pilots
    observations.set(entity.key, { entity, ...emptyCombat(), weapons: new Map() })
  }
  for (const event of interactions) {
    if (event.kind !== 'damage' && event.kind !== 'miss') continue
    if (range && (event.t < range[0] || event.t > range[1])) continue
    const source = entities[event.from]
    if (!source) continue
    if (!uploaders.has(event.from) && source.side !== ours &&
      !(uploaders.has(event.to) && entities[event.to]?.side === ours)) continue
    const weapon = event.weapon ?? '未记录武器'
    const catalogClass = entry(classes, weapon, () => classifyWeapon(weapon))
    const weaponClass = catalogClass === 'breacher' ? 'missile' : catalogClass
    const outcome = event.kind === 'damage' && isUngradedWeapon(catalogClass)
      ? null
      : hitOutcome(event)
    const side = entry(sides, source.side, () => ({ ...emptyCombat(), minutes: new Map() }))
    record(side, outcome, event.amount)
    record(entry(side.classes, weaponClass, emptyCounts), outcome, event.amount)
    if (outcome !== null) record(entry(side.minutes, Math.floor(event.t / HIT_MINUTE) * HIT_MINUTE, emptyCounts), outcome, event.amount)
    const pilot = pilots.get(source.key) ?? unidentified.get(source.key)
    if (!pilot) continue
    record(pilot, outcome, event.amount)
    record(entry(pilot.classes, weaponClass, emptyCounts), outcome, event.amount)
    record(entry(pilot.weapons, weapon, emptyCounts), outcome, event.amount)
  }
  const rankings = new Map<number | undefined, Map<HitMetric, HitRanking>>()
  function ranking(metric: HitMetric, side?: number): HitRanking {
    const byMetric = entry(rankings, side, () => new Map<HitMetric, HitRanking>())
    return entry(byMetric, metric, () => rankPilots(
      side === undefined ? pilots.values() : [...pilots.values()].filter(({ entity }) => entity.side === side),
      metric,
    ))
  }
  return { pilots, unidentified, sides, ranking }
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
type HitRanking = ReturnType<typeof rankPilots>

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
  return { ranked, insufficient, byPilot: new Map(ranked.map((row) => [row.pilot.entity.key, row])) }
}

export function weaponRows(pilot: PilotHits) {
  return [...pilot.weapons].sort(([a, first], [b, second]) => shotTotal(second) - shotTotal(first) || a.localeCompare(b))
}

export const shotTotal = (counts: ShotCounts) => counts.shots + counts.ungraded
