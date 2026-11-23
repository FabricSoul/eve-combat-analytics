import type { BattleData } from '../../state/battle-store'
import type { EwarSpan, Interaction } from '@/core/contract'
import recorded from './u7-pilot-events.json'

type EventTuple = [
  offset: number, from: Interaction['from'], to: Interaction['to'], kind: Interaction['kind'],
  amount: number, weapon: Interaction['weapon'], quality: Interaction['quality'],
  repairType: Interaction['repairType'], ewar: Interaction['ewar'],
]

const interactions: Interaction[] = (recorded.events as EventTuple[]).map(
  ([offset, from, to, kind, amount, weapon, quality, repairType, ewar]) => ({
    t: recorded.from + offset, from, to, kind, amount, weapon, quality, repairType, ewar, sources: [],
    corroborated: false,
  }),
)

// U1's fixture has whole-battle totals and three minutes of replay. Restore the full
// interaction series for the two pilots displayed on the approved person and fit boards.
export const fullPilotGalleryData = ({ analysis, summary }: BattleData): BattleData => ({
  summary,
  analysis: {
    ...analysis,
    interactions,
    ewarSpans: recorded.ewars as EwarSpan[],
    timeline: { ...analysis.timeline, start: recorded.from },
  },
})
