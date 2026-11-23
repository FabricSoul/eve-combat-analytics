import type { Analysis, BattleSummary, EntityKey } from '@/core/contract'
import { sideOrder } from '@/app/lib/sides'
import type { LayerId, TimeRange } from '@/app/state/view-store'

export const second = 1000
const smoothingSeconds = 10

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function zoomDomain(
  full: TimeRange, current: TimeRange, anchor: number, scale: number, destination = anchor,
): TimeRange {
  const fullSpan = full[1] - full[0]
  const span = clamp((current[1] - current[0]) * scale, Math.min(5 * second, fullSpan), fullSpan)
  const focalTime = current[0] + (current[1] - current[0]) * anchor
  const start = clamp(focalTime - span * destination, full[0], full[1] - span)
  return [start, start + span]
}

export function timelineSides(summary: BattleSummary, analysis: Analysis | null, ours: number) {
  const known = analysis ? sideOrder(analysis, ours) : [ours]
  return [...new Set([...known, ...summary.meta.teams.keys()])].filter((side) => side >= 0)
}

function rollingMean(samples: readonly number[]) {
  let sum = 0
  return samples.map((value, index) => {
    sum += value - (samples[index - smoothingSeconds] ?? 0)
    return sum / smoothingSeconds
  })
}

export function timelineData(summary: BattleSummary, analysis: Analysis | null, ours: number) {
  const kills = summary.meta.killmails
  const interactions = analysis?.interactions ?? []
  const start = analysis?.timeline.start || summary.meta.windows[0]?.start || kills[0]?.t || 0
  const damage = new Map<number, number[]>()
  let length = 0
  for (const [side, samples] of Object.entries(analysis?.timeline.damageBySide ?? {})) {
    damage.set(Number(side), rollingMean(samples))
    length = Math.max(length, samples.length)
  }

  let first = start
  let last = Math.max(start, interactions.at(-1)?.t ?? 0, start + Math.max(0, length - 1) * second)
  for (const { t } of kills) {
    first = Math.min(first, t)
    last = Math.max(last, t)
  }
  const full: TimeRange = [first, Math.max(first + second, last)]
  const eventTimes = [...new Set([...interactions.map(({ t }) => t), ...kills.map(({ t }) => t)])].sort((a, b) => a - b)
  const primaries = analysis?.primaries.filter(({ bySide }) => bySide === ours) ?? []
  return { full, start, damage, eventTimes, primaries }
}

export function nextEvent(times: readonly number[], t: number) {
  let left = 0
  let right = times.length
  while (left < right) {
    const middle = (left + right) >>> 1
    if (times[middle]! <= t) left = middle + 1
    else right = middle
  }
  return times[left]
}

export function repairs(analysis: Analysis | null, ours: number, start: number, end: number) {
  if (!analysis?.interactions.length) return []
  const buckets = Array<number>(Math.floor((end - start) / second) + 1).fill(0)
  for (const hit of analysis.interactions) {
    if (hit.kind !== 'repair' || hit.repairType === 'capacitor' || analysis.entities[hit.from]?.side !== ours) continue
    const i = Math.floor((hit.t - start) / second)
    if (buckets[i] !== undefined) buckets[i] += hit.amount
  }
  return rollingMean(buckets)
}

export function pointed(analysis: Analysis | null, ours: number, start: number, end: number) {
  if (!analysis?.ewarSpans.length) return []
  const length = Math.floor((end - start) / second) + 1
  const changes = Array<number>(length + 1).fill(0)
  const byTarget = new Map<EntityKey, [number, number][]>()
  for (const span of analysis.ewarSpans) {
    if (analysis.entities[span.from]?.side !== ours || (span.ewar !== 'warp_scramble' && span.ewar !== 'warp_disrupt')) continue
    const first = Math.floor((span.start - start) / second)
    const last = Math.floor((span.end - start) / second)
    if (last < 0 || first >= length) continue
    const intervals = byTarget.get(span.to) ?? []
    intervals.push([Math.max(0, first), Math.min(length - 1, last)])
    byTarget.set(span.to, intervals)
  }
  // Count targets once even when several pilots point the same target.
  for (const intervals of byTarget.values()) {
    let previousEnd = -1
    intervals.sort(([a], [b]) => a - b)
    for (const [first, last] of intervals) {
      if (last <= previousEnd) continue
      changes[Math.max(first, previousEnd + 1)]!++
      changes[last + 1]!--
      previousEnd = last
    }
  }
  let count = 0
  return changes.slice(0, length).map((change) => count += change)
}

export type LaneId = 'primary' | 'damage' | 'repair' | 'point' | 'kills'
export interface Lane { id: LaneId; top: number; height: number; label: string }

export function timelineLayout(compact: boolean, layers: ReadonlySet<LayerId>, hasDamage: boolean) {
  const lanes: Lane[] = []
  let y = compact ? 2 : 6
  function add(id: LaneId, height: number, label: string, gap = 0) {
    y += gap
    lanes.push({ id, top: y, height, label })
    y += height
  }
  if (compact) {
    add('damage', 48, '伤害/秒')
    add('kills', 14, '击毁')
    return { lanes, height: y, killIcons: false }
  }

  const killIcons = layers.has('kills') && layers.has('killIcons')
  if (layers.has('primary')) add('primary', 14, '主目标')
  if (hasDamage) add('damage', 70, '伤害/秒')
  if (layers.has('repOurs')) add('repair', 40, '我方维修', 6)
  if (layers.has('point')) add('point', 28, '点住的人数', 6)
  if (layers.has('kills')) add('kills', killIcons ? 56 : 14, '击毁', 4)
  return { lanes, height: y + 16, killIcons }
}
