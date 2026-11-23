import type { Entity, EntityKey, EwarSpan, Interaction, PilotStats } from '../contract'
import { floorSecond, type PrimaryHitRange } from './primaries'

interface PilotAccumulator {
  stats: PilotStats
  engagementStart: number | null
  engagementEnd: number | null
  firstShot: number | null
  lastDamageSecond: number | null
  activeSeconds: number
  primaryDamage: number
  switches: number[]
  reactions: number[]
}

interface DamageEpisodes {
  lastDamage: number
  starts: number[]
}

function touch(pilot: PilotAccumulator | undefined, t: number): void {
  if (pilot) {
    pilot.engagementStart ??= t
    pilot.engagementEnd = t
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  values.sort((a, b) => a - b)
  const middle = Math.floor(values.length / 2)
  return values.length % 2 === 1 ? values[middle]! : (values[middle - 1]! + values[middle]!) / 2
}

function collectRepairs(
  needsRepair: Map<EntityKey, DamageEpisodes>,
  repairedBy: Map<EntityKey, Map<PilotAccumulator, number[]>>,
): void {
  for (const [friend, healers] of repairedBy) {
    const episodes = needsRepair.get(friend)
    if (!episodes) continue
    for (const [healer, times] of healers) {
      let next = 0
      for (const start of episodes.starts) {
        while (next < times.length && times[next]! < start) next++
        const repair = times[next]
        if (repair === undefined) break
        if (repair - start <= 30_000) healer.reactions.push((repair - start) / 1000)
      }
    }
  }
}

function attributePrimaryHits(
  ranges: PrimaryHitRange[],
  pilots: Map<EntityKey, PilotAccumulator>,
): void {
  const countedThrough = new Map<EntityKey, number>()
  for (const [index, { span, hits, first, afterLast }] of ranges.entries()) {
    const shooters = new Set<EntityKey>()
    const leader = hits[first]!.from
    const uncountedStart = countedThrough.get(span.target) ?? 0
    for (let i = first; i < afterLast; i++) {
      const { t, from, amount } = hits[i]!
      span.damage += amount
      const pilot = pilots.get(from)
      if (pilot) {
        // The same target's qualifying runs can overlap. Count each hit
        // once in the share, while preserving both spans' own totals.
        if (i >= uncountedStart) pilot.primaryDamage += amount
        if (index > 0 && from !== leader && !shooters.has(from)) pilot.switches.push((t - span.start) / 1000)
      }
      shooters.add(from)
    }
    span.shooters = [...shooters].sort()
    countedThrough.set(span.target, Math.max(afterLast, uncountedStart))
  }
}

export function collectStats(
  entities: Map<EntityKey, Entity>,
  interactions: Interaction[],
  ewarSpans: EwarSpan[],
  damageBySide: Interaction[][],
  primaries: PrimaryHitRange[][],
  killmailTotals: ReadonlyMap<EntityKey, { damage: number; count: number }>,
): PilotStats[] {
  const stats: PilotStats[] = []
  const pilots = new Map<EntityKey, PilotAccumulator>()
  for (const key of [...entities.keys()].sort()) {
    const entity = entities.get(key)!
    const killmails = killmailTotals.get(key)
    if (!entity.hasLog && !killmails) continue
    const pilot: PilotStats = {
      key,
      activeRatio: 0,
      damageOut: 0,
      damageIn: 0,
      repairOut: 0,
      repairIn: 0,
      neutOut: 0,
      neutIn: 0,
      primaryShare: 0,
      switchDelayMedian: null,
    switchAfterKillMedian: null,
      repReactionMedian: null,
      firstShotDelay: null,
      hitQuality: {},
      misses: 0,
      pointSeconds: 0,
      killmailDamage: killmails?.damage ?? 0,
      killmailCount: killmails?.count ?? 0,
    }
    stats.push(pilot)
    if (entity.hasLog) {
      pilots.set(key, {
        stats: pilot,
        engagementStart: null,
        engagementEnd: null,
        firstShot: null,
        lastDamageSecond: null,
        activeSeconds: 0,
        primaryDamage: 0,
        switches: [],
        reactions: [],
      })
    }
  }

  const needsRepair = new Map<EntityKey, DamageEpisodes>()
  const repairedBy = new Map<EntityKey, Map<PilotAccumulator, number[]>>()
  for (const { t, kind, from, to, amount, quality } of interactions) {
    const source = pilots.get(from)
    const target = pilots.get(to)
    touch(source, t)
    touch(target, t)
    switch (kind) {
      case 'damage': {
        if (source) {
          source.stats.damageOut += amount
          source.firstShot ??= t
          const second = floorSecond(t)
          if (second !== source.lastDamageSecond) {
            source.activeSeconds++
            source.lastDamageSecond = second
          }
          if (quality !== null) source.stats.hitQuality[quality] = (source.stats.hitQuality[quality] ?? 0) + 1
        }
        if (target) target.stats.damageIn += amount
        if (amount > 0) {
          const episodes = needsRepair.get(to)
          if (!episodes) needsRepair.set(to, { lastDamage: t, starts: [t] })
          else {
            if (t - episodes.lastDamage >= 10_000) episodes.starts.push(t)
            episodes.lastDamage = t
          }
        }
        break
      }
      case 'repair': {
        if (source) {
          source.stats.repairOut += amount
          const side = entities.get(from)!.side
          if (from !== to && side >= 0 && entities.get(to)!.side === side) {
            let healers = repairedBy.get(to)
            if (!healers) {
              healers = new Map()
              repairedBy.set(to, healers)
            }
            const times = healers.get(source)
            if (times) times.push(t)
            else healers.set(source, [t])
          }
        }
        if (target) target.stats.repairIn += amount
        break
      }
      case 'neut':
        if (source) source.stats.neutOut += amount
        if (target) target.stats.neutIn += amount
        break
      case 'miss':
        if (source) source.stats.misses++
        break
    }
  }

  for (const { from, ewar, start, end } of ewarSpans) {
    if (ewar !== 'warp_scramble' && ewar !== 'warp_disrupt') continue
    const pilot = pilots.get(from)
    if (pilot) pilot.stats.pointSeconds += (end - start) / 1000
  }
  collectRepairs(needsRepair, repairedBy)
  for (const ranges of primaries) attributePrimaryHits(ranges, pilots)
  for (const [key, pilot] of pilots) {
    const { engagementStart, engagementEnd, firstShot, activeSeconds, primaryDamage, reactions, switches } = pilot
    const sideFirstShot = damageBySide[entities.get(key)!.side]?.[0]?.t
    if (engagementStart !== null && engagementEnd !== null) {
      const engagedSeconds = (floorSecond(engagementEnd) - floorSecond(engagementStart)) / 1000 + 1
      pilot.stats.activeRatio = activeSeconds / engagedSeconds
    }
    if (firstShot !== null && sideFirstShot !== undefined) pilot.stats.firstShotDelay = (firstShot - sideFirstShot) / 1000
    if (pilot.stats.damageOut > 0) pilot.stats.primaryShare = primaryDamage / pilot.stats.damageOut
    pilot.stats.repReactionMedian = median(reactions)
    pilot.stats.switchDelayMedian = median(switches)
  }

  return stats
}
