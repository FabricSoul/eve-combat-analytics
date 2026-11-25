import { sideOf } from '../br/normalize'
import type { BattleState, Entity, EntityKey, Interaction, SideOverride, SideSubject } from '../contract'
import { charKey } from './entities'

export const MAX_BATTLE_SIDES = 8

type SideAssignment = Pick<Entity, 'side' | 'sideSource'>

export interface PilotAffiliation {
  corpId?: number | null
  allyId?: number | null
}

interface SideRecord {
  side: number
  affiliation?: PilotAffiliation
}

export type SideAssignments = Map<number, SideAssignment>

export function assignedSide(sides: SideAssignments, charId: number): SideAssignment {
  return sides.get(charId) ?? { side: -1, sideSource: 'unknown' }
}

interface ManualChoice {
  override: SideOverride
  index: number
}

function newest(a: ManualChoice | undefined, b: ManualChoice | undefined): ManualChoice | undefined {
  if (!a || !b) return a ?? b
  if (a.override.setAt !== b.override.setAt) return a.override.setAt > b.override.setAt ? a : b
  return a.index > b.index ? a : b
}

type SideAssignmentInput = Pick<BattleState, 'meta' | 'names' | 'sideOverrides'> & {
  logs: readonly Pick<BattleState['logs'][number], 'id' | 'charId' | 'side' | 'uploadedAt' | 'corpId' | 'allyId'>[]
}

export function indexSideAssignments(state: SideAssignmentInput) {
  const historical = new Map<number, SideRecord>()
  const killmails = [...state.meta.killmails].sort((a, b) => a.t - b.t || a.id - b.id)
  for (const { victim, attackers } of killmails) {
    for (const participant of [victim, ...attackers]) {
      const { charId } = participant
      if (charId === null || (historical.get(charId)?.side ?? -1) >= 0) continue
      const side = sideOf(participant, state.meta.teams)
      if (side >= 0 || !historical.has(charId)) historical.set(charId, { side, affiliation: participant })
    }
  }

  const fallbacks = new Map<number, SideRecord>()
  const logs = [...state.logs].sort((a, b) => b.uploadedAt - a.uploadedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const entry of [...logs, ...Object.values(state.names)]) {
    if (!entry) continue
    const previous = fallbacks.get(entry.charId)
    const affiliation = entry.corpId !== undefined || entry.allyId !== undefined ? entry : undefined
    fallbacks.set(entry.charId, {
      side: previous && previous.side >= 0 ? previous.side : entry.side,
      affiliation: previous?.affiliation ?? affiliation,
    })
  }

  const manual = new Map<SideSubject, ManualChoice>()
  for (const [index, override] of (state.sideOverrides ?? []).entries()) {
    if (override.source !== 'manual') continue
    manual.set(override.subject, newest(manual.get(override.subject), { override, index })!)
  }
  const manualOverrides = new Map<number, SideOverride>()
  let sideCount = state.meta.teams.length
  const activeSides = new Set(state.meta.teams.map((_, side) => side))
  const sideLimit = Math.max(sideCount, MAX_BATTLE_SIDES)
  for (const [subject, { override }] of manual) {
    const { side } = override
    if (!Number.isInteger(side) || side < 0 || side >= sideLimit) manual.delete(subject)
    else {
      if (subject.startsWith('char:')) manualOverrides.set(Number(subject.slice(5)), override)
      activeSides.add(side)
      sideCount = Math.max(sideCount, side + 1)
    }
  }

  const assignments: SideAssignments = new Map()
  const affiliations = new Map<number, PilotAffiliation>()
  for (const id of new Set([...historical.keys(), ...fallbacks.keys()])) {
    const history = historical.get(id)
    const fallback = fallbacks.get(id)
    const affiliation = history?.affiliation ?? fallback?.affiliation
    if (affiliation) affiliations.set(id, affiliation)
    const { corpId, allyId } = affiliation ?? {}
    const fromCorp = corpId == null ? undefined : manual.get(`corp:${corpId}`)
    const fromAlliance = allyId == null ? undefined : manual.get(`ally:${allyId}`)
    const override = manual.get(charKey(id)) ?? newest(fromCorp, fromAlliance)
    if (override) {
      manualOverrides.set(id, override.override)
      assignments.set(id, { side: override.override.side, sideSource: 'manual' })
    }
    else if (history && history.side >= 0) assignments.set(id, { side: history.side, sideSource: 'br' })
    else if (fallback && fallback.side >= 0) assignments.set(id, { side: fallback.side, sideSource: 'esi' })
    else assignments.set(id, { side: -1, sideSource: 'unknown' })
  }
  return { assignments, sideCount, activeSides, affiliations, manualOverrides, manualSubjects: [...manual.keys()] }
}

interface SideEvidence {
  charId: number
  logIds: Set<string> | null
  uploadedAt: number
  repairs: number[]
  damage: number[]
}

function evidenceSide(counts: number[], minimum: number): number {
  const total = counts.reduce((sum, count) => sum + count, 0)
  return total < minimum ? -1 : counts.findIndex((count) => count * 100 >= total * 85)
}

export function deriveSideOverrides(
  state: BattleState, interactions: Interaction[], entities: Map<EntityKey, Entity>, sides: SideAssignments, teamCount: number, source: 'own' | 'observed' = 'own',
): SideOverride[] {
  if (teamCount < 2) return []
  const binaryBr = state.meta.teams.length === 2

  const evidence = new Map<EntityKey, SideEvidence>()
  const createEvidence = (charId: number, logIds: Set<string> | null, uploadedAt: number): SideEvidence => ({
    charId, logIds, uploadedAt, repairs: Array<number>(teamCount).fill(0), damage: binaryBr ? [0, 0] : [],
  })
  if (source === 'own') {
    for (const { id, charId, uploadedAt } of state.logs) {
      const { sideSource } = assignedSide(sides, charId)
      if (sideSource === 'manual' || sideSource === 'log') continue
      const key = charKey(charId)
      const existing = evidence.get(key)
      if (existing) {
        existing.logIds!.add(id)
        existing.uploadedAt = Math.max(existing.uploadedAt, uploadedAt)
      } else evidence.set(key, createEvidence(charId, new Set([id]), uploadedAt))
    }
  } else {
    for (const { key, charId, hasLog, sideSource } of entities.values()) {
      if (charId !== null && !hasLog && sideSource !== 'manual') {
        evidence.set(key, createEvidence(charId, null, 0))
      }
    }
  }
  if (evidence.size === 0) return []

  for (const { kind, from, to, sources, t } of interactions) {
    if (kind !== 'repair' && (kind !== 'damage' || !binaryBr)) continue
    const witness = evidence.get(from)
    if (!witness || from === to) continue
    const { side, sideSource, hasLog } = entities.get(to)!
    if (witness.logIds) {
      if (sideSource === 'log' || !sources.some(({ logId }) => witness.logIds!.has(logId))) continue
    } else if (!hasLog) continue
    const counts = kind === 'repair' ? witness.repairs : witness.damage
    // Override-only sides can supply repair evidence, but are outside the BR damage pair.
    if (side < 0 || side >= counts.length || sideSource === 'unknown') continue
    counts[side] = counts[side]! + 1
    if (!witness.logIds) witness.uploadedAt = t
  }

  const overrides: SideOverride[] = []
  for (const { charId, uploadedAt, repairs, damage } of [...evidence.values()].sort((a, b) => a.charId - b.charId)) {
    const repairSide = evidenceSide(repairs, 20)
    const damageTarget = evidenceSide(damage, 50)
    const damageSide = damageTarget >= 0 ? 1 - damageTarget : -1
    if (repairSide >= 0 && damageSide >= 0 && repairSide !== damageSide) continue
    const confirmed = repairSide >= 0 ? repairSide : damageSide
    if (confirmed < 0 || confirmed === assignedSide(sides, charId).side) continue

    const repairReason = `repaired side ${confirmed}: ${repairs[confirmed]} events`
    const reason = binaryBr && confirmed < 2
      ? `${repairReason}, damaged side ${1 - confirmed}: ${damage[1 - confirmed]} events`
      : repairReason
    overrides.push({ subject: charKey(charId), side: confirmed, source: 'log', reason, setAt: uploadedAt })
    sides.set(charId, { side: confirmed, sideSource: 'log' })
  }
  return overrides
}
