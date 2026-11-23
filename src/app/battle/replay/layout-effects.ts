import type { Interaction, InteractionKind } from '@/core/contract'

export interface Point { x: number; y: number }

export function sideAnchors(order: readonly number[], width: number, height: number): Map<number, Point> {
  const center = { x: width / 2, y: height / 2 + 8 }
  const anchors = new Map<number, Point>([[-1, { x: center.x, y: height * 0.9 }]])
  for (const [index, side] of order.entries()) {
    let angle = Math.PI
    if (index > 0) {
      // The three-sided layout keeps the open space at the bottom for unassigned pilots.
      const slot = index - 1
      angle = order.length === 3 && slot === 1
        ? -Math.PI / 2
        : (slot + Number(slot >= order.length / 2)) * 2 * Math.PI / order.length
    }
    anchors.set(side, {
      x: center.x + Math.cos(angle) * width * 0.28,
      y: center.y + Math.sin(angle) * height * 0.29,
    })
  }
  return anchors
}

function logQuantile(values: number[]) {
  values.sort((a, b) => a - b)
  const low = Math.log(values[Math.floor(values.length * 0.1)] ?? 1)
  const high = Math.log(values[Math.floor(values.length * 0.99)] ?? 1)
  return (amount: number) => {
    if (!(amount > 0)) return 0
    if (high === low) return 0.5
    return Math.max(0, Math.min(1, (Math.log(amount) - low) / (high - low)))
  }
}

export function interactionScales(interactions: readonly Interaction[]) {
  const amounts: Record<InteractionKind, number[]> = { damage: [], repair: [], neut: [], nos: [], ewar: [], miss: [] }
  for (const { amount, kind } of interactions) if (amount > 0) amounts[kind].push(amount)
  return {
    damage: logQuantile(amounts.damage),
    repair: logQuantile(amounts.repair),
    neut: logQuantile(amounts.neut),
    nos: logQuantile(amounts.nos),
    ewar: logQuantile(amounts.ewar),
    miss: logQuantile(amounts.miss),
  }
}

export const tracerWidth = (strength: number) => 1 + 3 * strength

export function impactShake(strength: number, age: number, reducedMotion: boolean): number {
  return reducedMotion || age < 0 ? 0 : (1 + 7 * strength) * Math.max(0, 1 - age / 320)
}

/** First event strictly after t in a time-ordered array. */
export function upperTimeIndex(events: readonly { t: number }[], t: number): number {
  let low = 0
  let high = events.length
  while (low < high) {
    const mid = (low + high) >>> 1
    if (events[mid]!.t <= t) low = mid + 1
    else high = mid
  }
  return low
}

export function interactionWindow(events: readonly { t: number }[], t: number, fade: number): [number, number] {
  return [upperTimeIndex(events, t - fade), upperTimeIndex(events, t)]
}
