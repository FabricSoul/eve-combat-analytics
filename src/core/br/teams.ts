import type { Killmail, KillmailParticipant, TeamMember } from '../contract'

/** Node for the alliance graph: the alliance, or the corporation when the pilot has none. */
function nodeOf(p: KillmailParticipant): TeamMember | null {
  if (p.allyId !== null) return `ally:${p.allyId}`
  if (p.corpId !== null) return `corp:${p.corpId}`
  return null
}

/** Tiny deterministic PRNG (mulberry32) so restarts are reproducible. */
function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const RESTARTS = 24

/**
 * Teams for a battle that has none (related links). Alliances (corps without one) are nodes; attackers on one
 * killmail are "same side" (+1 per co-occurrence), a victim against its attackers is "opposite" (-1). Two sides are
 * chosen to maximise agreement: greedy seed + local flips, plus seeded restarts. Side 0 is the side with more
 * pilots. Deterministic, and independent of killmail order.
 */
export function inferTeams(killmails: Killmail[]): TeamMember[][] {
  const pilots = new Map<TeamMember, Set<number>>()
  const same = new Map<string, number>()
  const diff = new Map<string, number>()
  const seen = (n: TeamMember, p: KillmailParticipant) => {
    let set = pilots.get(n)
    if (!set) pilots.set(n, (set = new Set()))
    if (p.charId !== null) set.add(p.charId)
  }
  const key = (a: TeamMember, b: TeamMember) => (a < b ? `${a}|${b}` : `${b}|${a}`)
  const bump = (m: Map<string, number>, a: TeamMember, b: TeamMember) => {
    if (a !== b) m.set(key(a, b), (m.get(key(a, b)) ?? 0) + 1)
  }

  for (const k of killmails) {
    const v = nodeOf(k.victim)
    if (v) seen(v, k.victim)
    const attackers = new Map<TeamMember, true>()
    for (const a of k.attackers) {
      const n = nodeOf(a)
      if (!n) continue
      seen(n, a)
      attackers.set(n, true)
    }
    const nodes = [...attackers.keys()].sort()
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) bump(same, nodes[i]!, nodes[j]!)
    if (v) for (const a of nodes) bump(diff, v, a)
  }

  const nodes = [...pilots.keys()].sort()
  if (nodes.length === 0) return [[], []]
  const idx = new Map(nodes.map((n, i) => [n, i]))
  const n = nodes.length
  // w[i][j] = same-side weight minus opposite-side weight; pos[i][j] = co-occurrence (same-side) count
  const w = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  const pos = Array.from({ length: n }, () => new Array<number>(n).fill(0))
  for (const [k, c] of same) {
    const [a, b] = k.split('|') as [TeamMember, TeamMember]
    const i = idx.get(a)!, j = idx.get(b)!
    w[i]![j]! += c; w[j]![i]! += c; pos[i]![j]! += c; pos[j]![i]! += c
  }
  for (const [k, c] of diff) {
    const [a, b] = k.split('|') as [TeamMember, TeamMember]
    const i = idx.get(a)!, j = idx.get(b)!
    w[i]![j]! -= c; w[j]![i]! -= c
  }

  /** Agreement gained by node i being on side s, given the others. */
  const pull = (side: number[], i: number, s: number) => {
    let g = 0
    for (let j = 0; j < n; j++) if (j !== i && w[i]![j] !== 0 && side[j] !== -1) g += side[j] === s ? w[i]![j]! : -w[i]![j]!
    return g
  }
  const score = (side: number[]) => {
    let t = 0
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) t += side[i] === side[j] ? w[i]![j]! : -w[i]![j]!
    return t
  }
  const improve = (side: number[]) => {
    for (let pass = 0; pass < 100; pass++) {
      let moved = false
      for (let i = 0; i < n; i++) {
        if (pull(side, i, 1 - side[i]!) > pull(side, i, side[i]!)) {
          side[i] = 1 - side[i]!
          moved = true
        }
      }
      if (!moved) break
    }
  }

  // Greedy seed: strongest nodes first, each to the side it agrees with more.
  const strength = nodes.map((_, i) => w[i]!.reduce((a, b) => a + Math.abs(b), 0))
  const order = nodes.map((_, i) => i).sort((a, b) => strength[b]! - strength[a]! || a - b)
  let best = new Array<number>(n).fill(-1)
  for (const i of order) best[i] = pull(best, i, 1) > pull(best, i, 0) ? 1 : 0
  improve(best)
  let bestScore = score(best)

  const rand = rng(0x9e3779b9)
  for (let r = 0; r < RESTARTS; r++) {
    const side = nodes.map(() => (rand() < 0.5 ? 0 : 1))
    improve(side)
    const sc = score(side)
    if (sc > bestScore) { best = side; bestScore = sc }
  }

  // Nodes the graph cannot place (equal pull both ways) are set aside and placed after the sides are numbered.
  const tied = nodes.map((_, i) => pull(best, i, 0) === pull(best, i, 1))
  const placed = nodes.map((_, i) => (tied[i] ? -1 : best[i]!))
  const count = (s: number) =>
    nodes.reduce((t, node, i) => t + (placed[i] === s ? pilots.get(node)!.size : 0), 0)
  // Side 0 = more pilots; on a tie the side holding the smallest node key.
  const first = placed.find((x) => x !== -1)
  const flip = count(1) > count(0) || (count(1) === count(0) && first === 1)
  const final = placed.map((x) => (x === -1 ? -1 : flip ? 1 - x : x))
  for (let i = 0; i < n; i++) {
    if (!tied[i]) continue
    let c0 = 0, c1 = 0
    for (let j = 0; j < n; j++) if (j !== i) (final[j] === 0 ? (c0 += pos[i]![j]!) : final[j] === 1 ? (c1 += pos[i]![j]!) : 0)
    final[i] = c0 > c1 ? 0 : 1
  }
  const teams: TeamMember[][] = [[], []]
  nodes.forEach((node, i) => teams[final[i]!]!.push(node))
  return teams
}
