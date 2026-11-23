import { indexSideAssignments } from '@/core/analysis/sides'
import type { BattleSummary } from '@/core/contract'

export interface PilotAffiliation {
  corpId: number
  allyId: number | null
}

const indexes = new WeakMap<BattleSummary, ReturnType<typeof indexSideAssignments>>()

export function sideIndexOf(summary: BattleSummary) {
  let index = indexes.get(summary)
  if (!index) {
    index = indexSideAssignments(summary)
    indexes.set(summary, index)
  }
  return index
}

/** The historical or fallback affiliation used by the analysis engine. */
export function affiliationOf(summary: BattleSummary, charId: number): PilotAffiliation | null {
  const affiliation = sideIndexOf(summary).affiliations.get(charId)
  return affiliation?.corpId == null ? null : { corpId: affiliation.corpId, allyId: affiliation.allyId ?? null }
}
