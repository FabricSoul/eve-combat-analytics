/**
 * Gallery-only example data. J125990 has two sides, so the three- and four-side layouts are shown on a COPY of the real
 * data in which pilots were moved by rule (not measured): every third pilot of side 0 goes to side 2, every sixth to
 * side 3. Names, ids and numbers are the real ones; only `side` (and the coverage counts derived from it) differ.
 * Never use this outside the gallery.
 */
import type { Analysis, BattleSummary, Entity, EntityKey } from '@/core/contract'

export interface Fixture { summary: BattleSummary; analysis: Analysis }

export function withExtraSides(fixture: Fixture): Fixture {
  let counter = 0
  const entities = Object.fromEntries(Object.entries(fixture.analysis.entities).map(([key, entity]) => {
    if (entity.side !== 0 || entity.charId === null) return [key, entity]
    counter++
    const side = counter % 6 === 0 ? 3 : counter % 3 === 0 ? 2 : 0
    return [key, side === 0 ? entity : { ...entity, side, sideSource: 'manual' as const }]
  }))
  const known = new Map<number, number>()
  for (const entity of Object.values(entities)) {
    if (entity.charId !== null && entity.side >= 0) known.set(entity.side, (known.get(entity.side) ?? 0) + 1)
  }
  const coverage = [...known].map(([side, count]) => ({
    side, known: count, withLog: Object.values(entities).filter((e) => e.side === side && e.hasLog).length,
  }))
  return { summary: fixture.summary, analysis: { ...fixture.analysis, entities, coverage } }
}

/** Single-pilot battle for one roster row state. */
export function onlyPilot(fixture: Fixture, key: EntityKey, patch: Partial<Entity> = {}): Fixture {
  const entity = fixture.analysis.entities[key]
  if (!entity) throw new Error(`no entity ${key}`)
  return {
    summary: fixture.summary,
    analysis: {
      ...fixture.analysis,
      entities: { [key]: { ...entity, ...patch } } as Record<EntityKey, Entity>,
      stats: fixture.analysis.stats.filter((stats) => stats.key === key),
      coverage: fixture.analysis.coverage,
    },
  }
}
