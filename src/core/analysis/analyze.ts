import type { Analysis, Analyze, Entity, EntityKey, Interaction } from '../contract'
import { collectCoverage, indexKillmails } from './entities'
import { collectEwarSpans, collectInteractions } from './interactions'
import { detectPrimaries, floorSecond } from './primaries'
import { collectStats } from './stats'

function indexDamage(
  interactions: Interaction[],
  entities: Map<EntityKey, Entity>,
  sideCount: number,
  firstKill: number,
) {
  const first = interactions[0]
  const last = interactions.at(-1)
  const start = first ? floorSecond(first.t) : firstKill
  const length = last ? (floorSecond(last.t) - start) / 1000 + 1 : 0
  const damageBySide: Analysis['timeline']['damageBySide'] = {}
  const shotsBySide: Interaction[][] = []
  for (let side = 0; side < sideCount; side++) {
    damageBySide[side] = Array<number>(length).fill(0)
    shotsBySide.push([])
  }
  for (const interaction of interactions) {
    if (interaction.kind !== 'damage') continue
    const side = entities.get(interaction.from)!.side
    const buckets = damageBySide[side]
    if (!buckets) continue
    const second = Math.floor((interaction.t - start) / 1000)
    buckets[second] = buckets[second]! + interaction.amount
    shotsBySide[side]!.push(interaction)
  }
  return { timeline: { start, damageBySide }, shotsBySide }
}

export const analyze: Analyze = (state) => {
  const sideCount = state.meta.teams.length
  const entities = new Map<EntityKey, Entity>()
  const interactions = collectInteractions(state, entities)
  const { totals, deaths, firstKill } = indexKillmails(state.meta, entities)
  const ewarSpans = collectEwarSpans(interactions)
  const coverage = collectCoverage(entities, sideCount)
  const { timeline, shotsBySide } = indexDamage(interactions, entities, sideCount, firstKill)
  const primariesBySide = shotsBySide.map((damage, side) => detectPrimaries(side, damage, timeline.start, entities, deaths))
  const stats = collectStats(entities, interactions, ewarSpans, shotsBySide, primariesBySide, totals)
  const primaries = primariesBySide.flatMap((ranges) => ranges.map(({ span }) => span))
    .sort((a, b) => a.start - b.start || a.bySide - b.bySide)
  const entityRecord = Object.fromEntries([...entities].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  return { entities: entityRecord, interactions, ewarSpans, primaries, stats, coverage, timeline }
}
