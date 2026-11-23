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

export function detectPrimaries(
  bySide: number,
  damage: Interaction[],
  timelineStart: number,
  entities: Map<EntityKey, Entity>,
  deaths: Map<EntityKey, number[]>,
): PrimaryTarget[] {
  const hits = damage.filter(({ amount }) => amount > 0)
  const spans: PrimaryTarget[] = []
  const targets = new Map<EntityKey, TargetDamage>()
  const isEnemy = (key: EntityKey) => {
    const side = entities.get(key)!.side
    return side >= 0 && side !== bySide
  }

  // The window beginning at each second determines that second's primary.
  // Each hit enters and leaves the window once.
  let left = 0
  let right = 0
  let total = 0
  let start = timelineStart
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
      const last = spans.at(-1)
      if (last?.target === target && start - last.end < BRIDGE_MS) {
        last.end = start + STEP_MS
      } else {
        spans.push({ target, bySide, start, end: start + STEP_MS, killedAt: null, damage: 0, shooters: [] })
      }
    }
    start += STEP_MS
  }

  for (const span of spans) {
    span.killedAt = deaths.get(span.target)?.find((t) => t >= span.start && t <= span.end + KILL_GRACE_MS) ?? null
  }
  return spans
}
