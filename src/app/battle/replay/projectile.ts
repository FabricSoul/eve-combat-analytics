import type { EntityKey, InteractionKind } from '@/core/contract'
import type { Point } from './layout-effects'
import type { ReplayEdge } from './scene'

export const shotTravelMs = 650
export const maxProjectileTravelMs = 900

export function projectileTravelMs(source: Point, stop: Point) {
  return Math.min(maxProjectileTravelMs, Math.max(250, Math.hypot(stop.x - source.x, stop.y - source.y) / 1.1))
}

export function isProjectile(kind: InteractionKind) {
  return kind === 'damage' || kind === 'repair' || kind === 'miss'
}

export function projectileAt(
  kind: InteractionKind, source: Point, target: Point, age: number, reducedMotion: boolean, pathEnd: number, travel = shotTravelMs,
) {
  const continuous = kind === 'ewar' || kind === 'neut' || kind === 'nos'
  const progress = reducedMotion ? 1 : continuous ? 0 : Math.max(0, Math.min(1, age / travel))
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

export interface Flight {
  edge: ReplayEdge
  pair: string
  start: number
  end: number
  arrived: boolean
}

export function createProjectilePlayback() {
  let lastTime: number | null = null
  let flights: Flight[] = []
  const lanes = new Map<string, [number, number, number]>()

  function seeking(t: number, playing: boolean) {
    return lastTime !== null && (t < lastTime || t - lastTime > (playing ? 2500 : 0))
  }

  function endpoints(t?: number, playing = false) {
    const keys = new Set<EntityKey>()
    if (t !== undefined && seeking(t, playing)) return keys
    for (const { edge, arrived } of flights) {
      if (arrived) continue
      keys.add(edge.from)
      keys.add(edge.to)
    }
    return keys
  }

  function advance(
    edges: readonly ReplayEdge[], t: number, playing: boolean, linger: number,
    travelFor: (edge: ReplayEdge) => number | null,
  ) {
    if (seeking(t, playing)) {
      flights = []
      lanes.clear()
      lastTime = null
    }
    if (t === lastTime) return flights
    flights = flights.filter((flight) => !flight.arrived || t <= flight.end + linger)
    // An identical module firing in the same recorded instant is shown as one salvo.
    const salvos = new Set<string>()
    let salvoTime = -Infinity
    const after = lastTime ?? t - linger - maxProjectileTravelMs
    for (const edge of edges) {
      if (!isProjectile(edge.kind) || edge.t <= after || edge.t > t) continue
      if (edge.t !== salvoTime) {
        salvoTime = edge.t
        salvos.clear()
      }
      const pair = `${edge.from}/${edge.to}`
      const salvo = `${pair}/${edge.kind}/${edge.weapon ?? ''}`
      if (salvos.has(salvo)) continue
      const travel = travelFor(edge)
      if (travel === null) continue
      salvos.add(salvo)
      const slots = lanes.get(pair) ?? [-Infinity, -Infinity, -Infinity]
      const slot = slots.indexOf(Math.min(...slots)) as 0 | 1 | 2
      const start = Math.max(edge.t, slots[slot])
      const end = start + travel
      slots[slot] = end
      lanes.set(pair, slots)
      flights.push({ edge, pair, start, end, arrived: false })
    }
    lastTime = t
    return flights
  }

  return { advance, endpoints }
}

export type ProjectilePlayback = ReturnType<typeof createProjectilePlayback>
