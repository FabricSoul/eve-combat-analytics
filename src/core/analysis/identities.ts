import type { BattleState, Counterparty, Entity, EntityKey, IdentityMerge, LogEvent, UploadedLog } from '../contract'
import { isDroneType, isEquipmentLabel, isKnownNonPilotName, spaceObjectTypeId, splitGluedHull } from '../log/counterparty'
import { addShip, charKey } from './entities'
import { assignedSide, type SideAssignments } from './sides'

const SIGHTING_MS = 60_000
const UNKNOWN_SIDE = -1
export const EQUIPMENT_BUCKET_KEY = 'name:弹药与装备'

interface Character {
  charId: number
  side: number
  name: string
}

interface Sightings {
  character: Character
  byLog: Map<string | null, number[]>
}

type Candidates = Map<number, Sightings>
type ShipIndex = Map<number, Map<number, Candidates>>

function addSighting(
  index: ShipIndex, typeId: number, side: number, character: Character, t: number, logId: string | null,
): void {
  let sides = index.get(typeId)
  if (!sides) {
    sides = new Map()
    index.set(typeId, sides)
  }
  let candidates = sides.get(side)
  if (!candidates) {
    candidates = new Map()
    sides.set(side, candidates)
  }
  let sighting = candidates.get(character.charId)
  if (!sighting) {
    sighting = { character, byLog: new Map() }
    candidates.set(character.charId, sighting)
  }
  const times = sighting.byLog.get(logId)
  if (!times) sighting.byLog.set(logId, [t])
  else if (times.at(-1) !== t) times.push(t)
}

function hasSighting(times: number[], from: number, to: number): boolean {
  if (times[0]! > to || times.at(-1)! < from) return false
  let left = 0
  let right = times.length
  while (left < right) {
    const mid = (left + right) >>> 1
    if (times[mid]! < from) left = mid + 1
    else right = mid
  }
  return times[left]! <= to
}

function uniqueCandidate(
  candidates: Candidates | undefined, t: number, observer: UploadedLog,
): Character | undefined {
  let match: Character | undefined
  for (const { character, byLog } of candidates?.values() ?? []) {
    if (character.charId === observer.charId) continue
    for (const [logId, times] of byLog) {
      if (logId === observer.id || !hasSighting(times, t - SIGHTING_MS, t + SIGHTING_MS)) continue
      if (match) return
      match = character
      break
    }
  }
  return match
}

export function expectedSide(kind: LogEvent['kind'], listenerSide: number, brTeamCount: number): number {
  if (kind === 'repair') return listenerSide
  if (kind === 'damage' && brTeamCount === 2 && (listenerSide === 0 || listenerSide === 1)) return 1 - listenerSide
  return UNKNOWN_SIDE
}

export function indexIdentities(
  state: BattleState, logs: UploadedLog[], entities: Map<EntityKey, Entity>, assignments: SideAssignments,
) {
  const { meta, names } = state
  const ships: ShipIndex = new Map()
  const listenersByName = new Map<string, Character>()
  const listenersById = new Map<number, Character>()
  for (const { charId, charName } of logs) {
    const entity = entities.get(charKey(charId))!
    const character = { charId, name: entity.name, side: entity.side }
    listenersByName.set(charName, character)
    listenersById.set(charId, character)
  }
  const merges = new Map<EntityKey, IdentityMerge['to']>(state.identityMerges?.map(({ from, to }) => [from, to]))
  const namesById = new Map<number, string>()
  if (merges.size) {
    for (const [name, entry] of Object.entries(names)) if (entry) namesById.set(entry.charId, name)
  }

  function mergedCharacter(key: EntityKey): Character | undefined {
    const target = merges.get(key)
    if (!target) return
    const charId = Number(target.slice(5))
    return listenersById.get(charId) ?? {
      charId, side: assignedSide(assignments, charId).side,
      name: meta.names[charId]?.name ?? namesById.get(charId) ?? String(charId),
    }
  }

  const namedSightings = new Map<string, Character | null>()
  const byName = new Map<string, Character | null>()
  const equipmentLabels = new Map<string, boolean>()
  const brCharacters = new Set<number>()
  const recoveredHulls = new Map<string, ReturnType<typeof splitGluedHull>>()

  function equipment(label: string | null): boolean {
    if (!label) return false
    let known = equipmentLabels.get(label)
    if (known === undefined) {
      known = isEquipmentLabel(label.trim())
      equipmentLabels.set(label, known)
    }
    return known
  }

  function record(typeId: number, character: Character, t: number, logId: string | null) {
    addSighting(ships, typeId, UNKNOWN_SIDE, character, t, logId)
    if (character.side !== UNKNOWN_SIDE) addSighting(ships, typeId, character.side, character, t, logId)
  }

  for (const { t, victim, attackers } of meta.killmails) {
    for (const participant of [victim, ...attackers]) {
      const { charId, shipTypeId } = participant
      if (charId === null) continue
      brCharacters.add(charId)
      if (shipTypeId === null) continue
      const { side } = assignedSide(assignments, charId)
      record(shipTypeId, { charId, side, name: meta.names[charId]?.name ?? String(charId) }, t, null)
    }
  }

  function named(name: string): Character | null {
    const cached = byName.get(name)
    if (cached !== undefined) return cached
    const entry = Object.hasOwn(names, name) ? names[name] : null
    // Old indexes sometimes resolved a ship label to an unrelated character.
    // An actual listener or BR participant remains valid when explicitly named.
    const catalogName = isKnownNonPilotName(name)
    const character = catalogName && listenersByName.has(name) ? listenersByName.get(name)!
      : entry && (!catalogName || brCharacters.has(entry.charId)) ? {
        charId: entry.charId,
        side: assignedSide(assignments, entry.charId).side,
        name: meta.names[entry.charId]?.name ?? name,
      } : null
    byName.set(name, character)
    return character
  }

  function recordLabel(label: Counterparty, log: UploadedLog, t: number) {
    const { name, shipTypeId } = label
    if (name === null || shipTypeId == null || isDroneType(shipTypeId)) return
    let character = namedSightings.get(name)
    if (character === undefined) {
      const indexed = named(name)
      const known = indexed ? listenersById.get(indexed.charId) ?? indexed : listenersByName.get(name)
      character = known ?? null
      namedSightings.set(name, character)
    }
    if (character && character.charId !== log.charId) record(shipTypeId, character, t, log.id)
  }

  for (const log of logs) {
    for (const event of log.parsed.events) {
      recordLabel(event.other, log, event.t)
      if (event.kind === 'ewar_seen') recordLabel(event.source, log, event.t)
    }
  }
  for (const sides of ships.values()) {
    for (const candidates of sides.values()) {
      for (const { byLog } of candidates.values()) {
        for (const times of byLog.values()) times.sort((a, b) => a - b)
      }
    }
  }

  function bucket(key: EntityKey, name: string, side: number): EntityKey {
    if (!entities.has(key)) {
      entities.set(key, { key, name, charId: null, side, sideSource: 'unknown', shipTypes: [], hasLog: false })
    }
    return key
  }

  function recoverHull(name: string) {
    if (!recoveredHulls.has(name)) {
      const split = named(name) ? undefined : splitGluedHull(name)
      recoveredHulls.set(name, split && named(split.name) ? split : undefined)
    }
    return recoveredHulls.get(name)
  }

  function resolve(label: Counterparty, side: number, t: number, observer: UploadedLog): EntityKey {
    const { raw } = label
    // Older uploads stored projectile and hull text in the fallback fields.
    if (label.shipTypeId === null && equipment(label.shipType ?? label.name ?? raw)) {
      return bucket(EQUIPMENT_BUCKET_KEY, '弹药与装备', UNKNOWN_SIDE)
    }
    const untyped = label.shipType === null && label.name !== null ? label.name : null
    const bareHull = untyped === null ? null : spaceObjectTypeId(untyped)
    const recovered = untyped !== null && bareHull === null ? recoverHull(untyped) : undefined
    const shipTypeId = label.shipTypeId ?? bareHull ?? recovered?.shipTypeId ?? null
    const drone = shipTypeId !== null && isDroneType(shipTypeId)
    const name = bareHull === null ? recovered?.name ?? label.name : null
    const shipType = label.shipType ?? recovered?.shipType ?? (bareHull !== null ? label.name : null)
    // Keep a named drone owner's attribution and never add a drone as their hull.
    if (drone && (name === null || !named(name))) return bucket(`ship:0:${side}`, '无人机与舰载机', side)
    const shipOnly = name === null && shipTypeId !== null
    const unresolved = shipOnly ? `ship:${shipTypeId}:${side}` as const : `name:${name ?? raw}` as const
    const character = mergedCharacter(unresolved) ?? (name !== null
      ? named(name)
      : shipOnly
        ? uniqueCandidate(ships.get(shipTypeId)?.get(side), t, observer)
        : null)
    const shipName = shipTypeId == null ? undefined : meta.names[shipTypeId]?.name
    const key = character ? charKey(character.charId) : unresolved
    let entity = entities.get(key)
    if (!entity) {
      entity = {
        key,
        name: character?.name ?? (shipOnly ? shipName ?? shipType ?? raw : name ?? raw),
        charId: character?.charId ?? null,
        // An anonymous ship's bucket follows the observer's perspective.
        ...(character
          ? assignedSide(assignments, character.charId)
          : { side: shipOnly ? side : UNKNOWN_SIDE, sideSource: 'unknown' as const }),
        shipTypes: [],
        hasLog: false,
      }
      entities.set(key, entity)
    }
    if (!drone) addShip(entity, shipType ?? shipName)
    return key
  }

  return { resolve }
}
