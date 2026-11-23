import { sideOf } from '../br/normalize'
import type { BattleState, Coverage, Entity, EntityKey } from '../contract'

export const charKey = (id: number): EntityKey => `char:${id}`

export function addShip(entity: Entity, ship: string | null | undefined): void {
  if (ship != null && !entity.shipTypes.includes(ship)) entity.shipTypes.push(ship)
}

interface KillmailStats {
  damage: number
  count: number
  lastMailId: number
  entity: Entity
}

export function indexKillmails(meta: BattleState['meta'], entities: Map<EntityKey, Entity>) {
  const totals = new Map<EntityKey, KillmailStats>()
  const deaths = new Map<EntityKey, number[]>()
  const killmails = [...meta.killmails].sort((a, b) => a.t - b.t || a.id - b.id)

  for (const { victim, attackers, id, t } of killmails) {
    if (victim.charId !== null) {
      const key = charKey(victim.charId)
      const times = deaths.get(key)
      if (times) times.push(t)
      else deaths.set(key, [t])
    }

    for (const [position, participant] of [victim, ...attackers].entries()) {
      const { charId, shipTypeId } = participant
      if (charId === null) continue

      const key = charKey(charId)
      let entry = totals.get(key)
      if (!entry) {
        const entity = entities.get(key) ?? {
          key,
          name: meta.names[charId]?.name ?? String(charId),
          charId,
          side: sideOf(participant, meta.teams),
          hasLog: false,
          shipTypes: [],
        }
        entry = { damage: 0, count: 0, lastMailId: -1, entity }
        totals.set(key, entry)
      }
      if (position > 0) entry.damage += participant.damage
      if (entry.lastMailId !== id) {
        entry.count++
        entry.lastMailId = id
      }
      if (shipTypeId !== null) addShip(entry.entity, meta.names[shipTypeId]?.name)

      // A later killmail may be the first one that establishes this pilot's side.
      if (entry.entity.side === -1) entry.entity.side = sideOf(participant, meta.teams)
    }
  }

  for (const { entity } of totals.values()) entities.set(entity.key, entity)
  return { totals, deaths, firstKill: killmails[0]?.t ?? 0 }
}

export function collectCoverage(entities: Map<EntityKey, Entity>, sides: number): Coverage[] {
  const coverage = Array.from({ length: sides }, (_, side) => ({ side, known: 0, withLog: 0 }))
  for (const entity of entities.values()) {
    const side = coverage[entity.side]
    if (entity.charId === null || !side) continue
    side.known++
    if (entity.hasLog) side.withLog++
  }
  return coverage
}
