import type { Entity, EntityKey, EwarSpan, Interaction, PilotStats, PrimaryTarget } from '../contract'
import { floorSecond } from './primaries'

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
  damage: Interaction[],
  spans: PrimaryTarget[],
  pilots: Map<EntityKey, PilotAccumulator>,
): void {
  let spanIndex = 0
  let shooters = new Set<EntityKey>()
  for (const { t, amount, from, to } of damage) {
    let span = spans[spanIndex]
    while (span && span.end <= t) {
      span = spans[++spanIndex]
      shooters = new Set()
    }
    if (!span) break
    if (t < span.start || to !== span.target || amount <= 0) continue

    span.damage += amount
    const firstHit = !shooters.has(from)
    if (firstHit) {
      shooters.add(from)
      span.shooters.push(from)
    }
    const pilot = pilots.get(from)
    if (pilot) {
      pilot.primaryDamage += amount
      if (firstHit && spanIndex > 0) pilot.switches.push((t - span.start) / 1000)
    }
  }
  for (const span of spans) span.shooters.sort()
}

export function collectStats(
  entities: Map<EntityKey, Entity>,
  interactions: Interaction[],
  ewarSpans: EwarSpan[],
  damageBySide: Interaction[][],
  primaries: PrimaryTarget[][],
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
  for (const [side, damage] of damageBySide.entries()) attributePrimaryHits(damage, primaries[side]!, pilots)
  for (const [key, pilot] of pilots) {
    const { engagementStart, engagementEnd, firstShot, activeSeconds, primaryDamage, reactions, switches } = pilot
    const sideFirstShot = damageBySide[entities.get(key)!.side]?.[0]?.t
    if (engagementStart !== null && engagementEnd !== null && engagementEnd > engagementStart) {
      pilot.stats.activeRatio = activeSeconds / ((engagementEnd - engagementStart) / 1000)
    }
    if (firstShot !== null && sideFirstShot !== undefined) pilot.stats.firstShotDelay = (firstShot - sideFirstShot) / 1000
    if (pilot.stats.damageOut > 0) pilot.stats.primaryShare = primaryDamage / pilot.stats.damageOut
    pilot.stats.repReactionMedian = median(reactions)
    pilot.stats.switchDelayMedian = median(switches)
  }

  return stats
}
