import type { BattleSummary } from '@/core/contract'

export interface PilotAffiliation {
  corpId: number
  allyId: number | null
}

/** A pilot's corporation and alliance: battle-time killmail rows first, then the ESI name index. */
export function affiliationOf(summary: BattleSummary, charId: number): PilotAffiliation | null {
  for (const killmail of summary.meta.killmails) {
    for (const participant of [killmail.victim, ...killmail.attackers]) {
      if (participant.charId === charId && participant.corpId !== null) {
        return { corpId: participant.corpId, allyId: participant.allyId }
      }
    }
  }
  for (const value of Object.values(summary.names)) {
    if (value && value.charId === charId && value.corpId !== undefined) return { corpId: value.corpId, allyId: value.allyId ?? null }
  }
  return null
}
