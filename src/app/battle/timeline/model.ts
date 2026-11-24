import type { Analysis, BattleSummary, EntityKey } from '@/core/contract'
import { sideOrder } from '@/app/lib/sides'
import type { LayerId, TimeRange } from '@/app/state/view-store'

export const second = 1000
const smoothingSeconds = 10
const damageSmoothingRadius = 5

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

export function snapTimelineRange(anchor: number, edge: number, bounds: TimeRange, unsnapped: boolean): TimeRange {
  const step = Math.abs(edge - anchor) >= 60 * second ? 10 * second : second
  const first = Math.ceil(bounds[0] / step) * step
  const last = Math.floor(bounds[1] / step) * step
  function endpoint(time: number) {
    return unsnapped || first > last ? clamp(time, ...bounds) : clamp(Math.round(time / step) * step, first, last)
  }
  return [endpoint(Math.min(anchor, edge)), endpoint(Math.max(anchor, edge))]
}

export function eveTimeInRange(clock: string, previous: number, bounds: TimeRange): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d):([0-5]\d)$/.exec(clock)
  if (!match) return null
  const offset = (Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3])) * second
  const day = 86_400 * second
  const firstDay = Math.ceil((bounds[0] - offset) / day)
  const lastDay = Math.floor((bounds[1] - offset) / day)
  if (firstDay > lastDay) return null
  // The current endpoint identifies the closest UTC day when the clock repeats.
  const selectedDay = clamp(Math.round((previous - offset) / day), firstDay, lastDay)
  return selectedDay * day + offset
}

export function plotScale(width: number, left: number, right: number, start: number, end: number) {
  const plotWidth = Math.max(1, width - left - right)
  return (time: number) => left + plotWidth * (time - start) / (end - start)
}

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

export function centeredDamageMean(samples: readonly number[]) {
  let first = 0
  let afterLast = 0
  let sum = 0
  return samples.map((_, index) => {
    const start = Math.max(0, index - damageSmoothingRadius)
    const end = Math.min(samples.length, index + damageSmoothingRadius + 1)
    while (first < start) sum -= samples[first++]!
    while (afterLast < end) sum += samples[afterLast++]!
    return sum / (afterLast - first)
  })
}

export function activityBounds(summary: BattleSummary | null, analysis: Analysis | null): TimeRange | null {
  const interactions = analysis?.interactions
  let first = interactions?.[0]?.t ?? Infinity
  let last = interactions?.at(-1)?.t ?? -Infinity
  if (analysis?.timeline.start && interactions?.length) first = Math.min(first, analysis.timeline.start)
  for (const { t } of summary?.meta.killmails ?? []) {
    first = Math.min(first, t)
    last = Math.max(last, t)
  }
  return first <= last ? [first, last] : null
}

export function timelineData(summary: BattleSummary, analysis: Analysis | null, ours: number) {
  const kills = summary.meta.killmails
  const interactions = analysis?.interactions ?? []
  const activity = activityBounds(summary, analysis)
  const start = analysis?.timeline.start || activity?.[0] || summary.meta.windows[0]?.start || 0
  const damage = new Map<number, number[]>()
  for (const [side, samples] of Object.entries(analysis?.timeline.damageBySide ?? {})) {
    damage.set(Number(side), centeredDamageMean(samples))
  }

  const padding = activity ? clamp(Math.round((activity[1] - activity[0]) * 0.01), second, 5 * second) : 0
  const full: TimeRange = activity
    ? [Math.max(0, activity[0] - padding), activity[1] + padding]
    : [start, start + second]
  const eventTimes = [...new Set([...interactions.map(({ t }) => t), ...kills.map(({ t }) => t)])].sort((a, b) => a - b)
  const primaries = analysis?.primaries.filter(({ bySide }) => bySide === ours) ?? []
  return { full, activity, start, damage, eventTimes, primaries }
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
