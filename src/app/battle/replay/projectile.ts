import type { InteractionKind } from '@/core/contract'
import type { Point } from './layout-effects'

export const shotTravelMs = 650

export function projectileAt(
  kind: InteractionKind, source: Point, target: Point, age: number, reducedMotion: boolean, pathEnd: number,
) {
  const continuous = kind === 'ewar' || kind === 'neut' || kind === 'nos'
  const progress = reducedMotion ? 1 : continuous ? 0 : Math.max(0, Math.min(1, age / shotTravelMs))
  const head = progress * pathEnd
  return {
    head, continuous,
    position: { x: source.x + (target.x - source.x) * head, y: source.y + (target.y - source.y) * head },
  }
}

export function projectilePerPair<T extends { from: string; to: string; age: number }>(observations: Iterable<T>): T[] {
  const pairs = new Map<string, T>()
  for (const observation of observations) {
    const key = JSON.stringify([observation.from, observation.to])
    const current = pairs.get(key)
    if (!current || observation.age < current.age) pairs.set(key, observation)
  }
  return [...pairs.values()]
}
