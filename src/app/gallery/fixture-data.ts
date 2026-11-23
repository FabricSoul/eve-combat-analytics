import type { Analysis, BattleSummary, EwarSpan, Interaction } from '@/core/contract'

type EventSample = [offset: number, shape: number, amount: number]
type EventShape = [
  Interaction['from'], Interaction['to'], Interaction['kind'], Interaction['weapon'],
  Interaction['quality'], Interaction['repairType'], Interaction['ewar'],
]

export interface RecordedUiAnalysis extends Analysis {
  replayStart: number
  pilotSeries: { events: EventSample[]; shapes: EventShape[]; ewarSpans: EwarSpan[] }
}

export function createUiFixture(summary: BattleSummary, recorded: RecordedUiAnalysis) {
  const { replayStart, pilotSeries, ...analysis } = recorded
  const replay = { summary, analysis }
  let pilots: typeof replay | undefined

  function loadUiFixture(options?: { fullPilotEvents?: boolean }): typeof replay {
    if (!options?.fullPilotEvents) return replay
    return pilots ??= {
      summary,
      analysis: {
        ...analysis,
        interactions: pilotSeries.events.map(([offset, shape, amount]) => {
          // The fixture builder writes event triples indexed into this shape dictionary.
          const [from, to, kind, weapon, quality, repairType, ewar] = pilotSeries.shapes[shape]!
          return { t: analysis.timeline.start + offset, from, to, kind, amount,
            weapon, quality, repairType, ewar, sources: [], corroborated: false }
        }),
        ewarSpans: pilotSeries.ewarSpans,
      },
    }
  }

  return { replayStart, loadUiFixture }
}

export type UiFixtureSource = ReturnType<typeof createUiFixture>
