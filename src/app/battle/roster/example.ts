/**
 * Gallery-only example data. J125990 has two sides, so the three- and four-side layouts are shown on a COPY of the real
 * data in which pilots were moved by rule (not measured): every third pilot of side 0 goes to side 2, every sixth to
 * side 3. Names, ids and numbers are the real ones; only `side` (and the coverage counts derived from it) differ.
 * Never use this outside the gallery.
 */
import type { Analysis, BattleSummary, Entity, EntityKey } from '@/core/contract'
import { buildRoster, type RosterRow } from './model'

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

export interface RosterSamples {
  logged: RosterRow
  unlogged: RosterRow
  dead: RosterRow
  /** The dead sample's killmail time: the gallery's cursor for that state (before it the pilot is alive). */
  deadAt: number
  corrected: RosterRow
}

/**
 * Real pilots of our side for each roster-row state in the gallery. Throws when the data has no pilot for a state, so a
 * missing state cannot silently show somebody else. `dead` is the row as of its own killmail.
 */
export function rosterSamples(fixture: Fixture, ours: number): RosterSamples {
  const { summary, analysis } = fixture
  const start = analysis.timeline.start
  const firstLoss = new Map<number, number>()
  for (const { victim, t } of [...summary.meta.killmails].sort((a, b) => a.t - b.t)) {
    if (victim.charId !== null && !firstLoss.has(victim.charId)) firstLoss.set(victim.charId, t)
  }
  const rowsAt = (at: number) => buildRoster(summary, analysis, ours, at).flatMap((group) => group.rows)
  const alive = rowsAt(start).filter((row) => row.side === ours && row.charId !== null)
  const need = <T,>(state: string, found: T | undefined): T => {
    if (found === undefined) throw new Error(`no ${state} sample in this battle`)
    return found
  }
  const notLost = (row: RosterRow) => row.charId !== null && !firstLoss.has(row.charId)
  const logged = need('logged', alive.find((row) => row.hasLog && !row.tag && notLost(row)))
  const unlogged = need('unlogged', alive.find((row) => !row.hasLog && !row.tag && notLost(row)))
  const corrected = need('corrected', alive.find((row) => row.tag?.kind === 'log'))
  const lost = need('dead', alive.find((row) => row.charId !== null && (firstLoss.get(row.charId) ?? 0) > start))
  const deadAt = firstLoss.get(lost.charId!)!
  const dead = need('dead', rowsAt(deadAt).find((row) => row.key === lost.key))
  return { logged, unlogged, dead, deadAt, corrected }
}
