import type { Entity, EntityKey, Interaction, Killmail, PrimaryTarget, StatsForRange } from '../contract'
import { charKey } from './entities'
import type { PrimaryHitRange } from './primaries'
import { collectStats } from './stats'

function hitBoundary(hits: Interaction[], t: number, inclusive: boolean): number {
  let left = 0
  let right = hits.length
  while (left < right) {
    const mid = (left + right) >>> 1
    const time = hits[mid]!.t
    if (time < t || (inclusive && time === t)) left = mid + 1
    else right = mid
  }
  return left
}

function primaryRanges(
  primaries: PrimaryTarget[],
  bySide: Interaction[][],
  from: number,
  to: number,
): PrimaryHitRange[][] {
  return bySide.map((shots, side) => {
    const byTarget = new Map<EntityKey, Interaction[]>()
    const spans = primaries.filter((span) => span.bySide === side && span.end >= from && span.start <= to)
    for (const { target } of spans) byTarget.set(target, [])
    for (const shot of shots) if (shot.amount > 0) byTarget.get(shot.to)?.push(shot)

    const ranges: PrimaryHitRange[] = []
    for (const span of spans) {
      const hits = byTarget.get(span.target)!
      const first = hitBoundary(hits, span.start, false)
      const afterLast = hitBoundary(hits, span.end, true)
      if (first === afterLast) continue
      const killedAt = span.killedAt !== null && span.killedAt >= from && span.killedAt <= to ? span.killedAt : null
      ranges.push({
        hits, first, afterLast,
        span: { ...span, start: hits[first]!.t, end: hits[afterLast - 1]!.t, killedAt, damage: 0, shooters: [] },
      })
    }
    return ranges
  })
}

function killmailTotals(killmails: Killmail[], from: number, to: number) {
  const totals = new Map<EntityKey, { damage: number; count: number; lastMailId: number }>()
  const ordered = killmails.filter(({ t }) => t >= from && t <= to).sort((a, b) => a.t - b.t || a.id - b.id)
  for (const { id, victim, attackers } of ordered) {
    for (const [position, { charId, damage }] of [victim, ...attackers].entries()) {
      if (charId === null) continue
      const key = charKey(charId)
      let total = totals.get(key)
      if (!total) totals.set(key, total = { damage: 0, count: 0, lastMailId: -1 })
      if (position > 0) total.damage += damage
      if (total.lastMailId !== id) {
        total.count++
        total.lastMailId = id
      }
    }
  }
  return totals
}

export const statsForRange: StatsForRange = (analysis, killmails, from, to) => {
  const entities = new Map<EntityKey, Entity>(Object.values(analysis.entities).map((entity) => [entity.key, entity]))
  const interactions = analysis.interactions.filter(({ t }) => t >= from && t <= to)
  const bySide: Interaction[][] = []
  for (const side of Object.keys(analysis.timeline.damageBySide)) bySide[Number(side)] = []
  for (const interaction of interactions) {
    if (interaction.kind === 'damage') bySide[entities.get(interaction.from)!.side]?.push(interaction)
  }
  return collectStats(
    entities, interactions, analysis.ewarSpans, bySide, primaryRanges(analysis.primaries, bySide, from, to),
    killmailTotals(killmails, from, to), { from, to },
  )
}
