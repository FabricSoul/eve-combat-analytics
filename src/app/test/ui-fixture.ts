import type { Analysis, BattleSummary, EwarSpan, Interaction } from '@/core/contract'
import summary from '../../../fixtures/real/j125990-20250622/ui/summary.json'
import recorded from '../../../fixtures/real/j125990-20250622/ui/analysis.json'

type EventSample = [offset: number, shape: number, amount: number]
type EventShape = [
  Interaction['from'], Interaction['to'], Interaction['kind'], Interaction['weapon'],
  Interaction['quality'], Interaction['repairType'], Interaction['ewar'],
]

interface UiFixture {
  summary: BattleSummary
  analysis: Analysis
}

const { replayStart, pilotSeries, ...analysis } = recorded
export const uiReplayStart = replayStart
const replayFixture = { summary: summary as BattleSummary, analysis: analysis as Analysis }
let pilotFixture: UiFixture | undefined

export function loadUiFixture(options?: { fullPilotEvents?: boolean }): UiFixture {
  if (!options?.fullPilotEvents) return replayFixture

  return pilotFixture ??= {
    ...replayFixture,
    analysis: {
      ...replayFixture.analysis,
      interactions: (pilotSeries.events as EventSample[]).map(([offset, shape, amount]) => {
        // build-ui-fixture.ts writes triples and an index into the event shape dictionary.
        const [from, to, kind, weapon, quality, repairType, ewar] = (pilotSeries.shapes as EventShape[])[shape!]!
        return { t: analysis.timeline.start + offset, from, to, kind, amount,
          weapon, quality, repairType, ewar, sources: [], corroborated: false }
      }),
      ewarSpans: pilotSeries.ewarSpans as EwarSpan[],
    },
  }
}
