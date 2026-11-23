import type { BattleData } from '../../state/battle-store'

// Fictional three-side assignments for the gallery. The original pilots and combat values are real.
export function threeSideDemo({ analysis, summary }: BattleData): BattleData {
  const moved = analysis.coverage.find(({ side }) => side === 0)
  const keys = Object.values(analysis.entities).filter((entity) => entity.side === moved?.side && entity.charId !== null)
    .filter((_, index) => index % 3 === 0)
  const entities = { ...analysis.entities }
  for (const entity of keys) entities[entity.key] = { ...entity, side: 2 }
  const withLog = keys.filter((entity) => entity.hasLog).length
  const coverage = [...analysis.coverage.map((entry) => entry !== moved ? entry : {
    ...entry, known: entry.known - keys.length, withLog: entry.withLog - withLog,
  }), { side: 2, known: keys.length, withLog }]
  const teams = [...summary.meta.teams, []]
  return { analysis: { ...analysis, entities, coverage }, summary: { ...summary, meta: { ...summary.meta, teams } } }
}
