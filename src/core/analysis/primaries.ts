import type { Entity, EntityKey, Interaction, PrimaryTarget } from '../contract'

export const floorSecond = (t: number): number => Math.floor(t / 1000) * 1000
const WINDOW_MS = 10_000
const STEP_MS = 1000
const BRIDGE_MS = 5000
const KILL_GRACE_MS = 10_000

interface TargetDamage {
  damage: number
  shooters: Map<EntityKey, number>
}

function updateTarget(targets: Map<EntityKey, TargetDamage>, hit: Interaction, change: 1 | -1): void {
  let target = targets.get(hit.to)
  if (!target) {
    target = { damage: 0, shooters: new Map() }
    targets.set(hit.to, target)
  }
  target.damage += change * hit.amount
  const count = (target.shooters.get(hit.from) ?? 0) + change
  if (count === 0) target.shooters.delete(hit.from)
  else target.shooters.set(hit.from, count)
  if (target.shooters.size === 0) targets.delete(hit.to)
}

function chooseTarget(targets: Map<EntityKey, TargetDamage>, total: number): EntityKey | null {
  let highestDamage = 0
  let primary: EntityKey | null = null
  for (const [key, { damage, shooters }] of targets) {
    if (damage < highestDamage) continue
    if (damage > highestDamage) {
      highestDamage = damage
      primary = null
    }
    if (shooters.size >= 2 && (primary === null || key < primary)) primary = key
  }
  return highestDamage * 5 >= total * 2 ? primary : null
}

type PrimaryRun = Pick<PrimaryTarget, 'target' | 'bySide' | 'start' | 'end'>

export interface PrimaryHitRange {
  span: PrimaryTarget
  hits: Interaction[]
  first: number
  afterLast: number
}

function hitAtOrAfter(hits: Interaction[], t: number): number {
  let left = 0
  let right = hits.length
  while (left < right) {
    const mid = (left + right) >>> 1
    if (hits[mid]!.t < t) left = mid + 1
    else right = mid
  }
  return left
}

function clipRuns(
  runs: PrimaryRun[], hits: Interaction[], deaths: Map<EntityKey, number[]>,
): PrimaryHitRange[] {
  const byTarget = new Map<EntityKey, Interaction[]>()
  for (const { target } of runs) byTarget.set(target, [])
  for (const hit of hits) byTarget.get(hit.to)?.push(hit)

  const clipped = runs.map((run) => {
    const targetHits = byTarget.get(run.target)!
    const first = hitAtOrAfter(targetHits, run.start)
    const afterLast = hitAtOrAfter(targetHits, run.end)
    const start = targetHits[first]!.t
    const end = targetHits[afterLast - 1]!.t
    const killedAt = deaths.get(run.target)?.find((t) => t >= start && t <= end + KILL_GRACE_MS) ?? null
    return {
      span: { ...run, start, end, killedAt, damage: 0, shooters: [] },
      hits: targetHits,
      first,
      afterLast,
    }
  })
  return clipped.sort((a, b) => a.span.start - b.span.start)
}

export function detectPrimaries(
  bySide: number,
  damage: Interaction[],
  timelineStart: number,
  entities: Map<EntityKey, Entity>,
  deaths: Map<EntityKey, number[]>,
): PrimaryHitRange[] {
  const hits = damage.filter(({ amount }) => amount > 0)
  const runs: PrimaryRun[] = []
  const targets = new Map<EntityKey, TargetDamage>()
  const isEnemy = (key: EntityKey) => {
    const side = entities.get(key)!.side
    return side >= 0 && side !== bySide
  }

  // Qualifying windows form runs. Each hit enters and leaves the rolling window once.
  let left = 0
  let right = 0
  let total = 0
  let start = timelineStart
  let lastQualified = timelineStart
  while (left < hits.length) {
    while (left < right && hits[left]!.t < start) {
      const hit = hits[left++]!
      total -= hit.amount
      if (isEnemy(hit.to)) updateTarget(targets, hit, -1)
    }
    if (left === right) {
      const next = hits[right]
      if (!next) break
      start = Math.max(start, floorSecond(next.t) - WINDOW_MS + STEP_MS)
    }
    while (right < hits.length && hits[right]!.t < start + WINDOW_MS) {
      const hit = hits[right++]!
      total += hit.amount
      if (isEnemy(hit.to)) updateTarget(targets, hit, 1)
    }

    const target = chooseTarget(targets, total)
    if (target !== null) {
      const last = runs.at(-1)
      const end = start + WINDOW_MS
      if (last?.target === target && start - lastQualified - STEP_MS < BRIDGE_MS) last.end = end
      else runs.push({ target, bySide, start, end })
      lastQualified = start
    }
    start += STEP_MS
  }

  return runs.length > 0 ? clipRuns(runs, hits, deaths) : []
}
