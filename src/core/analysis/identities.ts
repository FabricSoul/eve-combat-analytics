import type { BattleState, Counterparty, Entity, EntityKey, LogEvent, UploadedLog } from '../contract'
import { addShip, charKey } from './entities'
import { assignedSide, type SideAssignments } from './sides'

const SIGHTING_MS = 60_000
const UNKNOWN_SIDE = -1

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

export function expectedSide(kind: LogEvent['kind'], listenerSide: number, sides: number): number {
  if (kind === 'repair') return listenerSide
  if (kind === 'damage' && sides === 2 && (listenerSide === 0 || listenerSide === 1)) return 1 - listenerSide
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
  const namedSightings = new Map<string, Character | null>()
  const byName = new Map<string, Character | null>()

  function record(typeId: number, character: Character, t: number, logId: string | null) {
    addSighting(ships, typeId, UNKNOWN_SIDE, character, t, logId)
    if (character.side !== UNKNOWN_SIDE) addSighting(ships, typeId, character.side, character, t, logId)
  }

  for (const { t, victim, attackers } of meta.killmails) {
    for (const participant of [victim, ...attackers]) {
      const { charId, shipTypeId } = participant
      if (charId === null || shipTypeId === null) continue
      const { side } = assignedSide(assignments, charId)
      record(shipTypeId, { charId, side, name: meta.names[charId]?.name ?? String(charId) }, t, null)
    }
  }

  function named(name: string): Character | null {
    const cached = byName.get(name)
    if (cached !== undefined) return cached
    const entry = Object.hasOwn(names, name) ? names[name] : null
    const character = entry ? {
      charId: entry.charId,
      side: assignedSide(assignments, entry.charId).side,
      name: meta.names[entry.charId]?.name ?? name,
    } : null
    byName.set(name, character)
    return character
  }

  function recordLabel(label: Counterparty, log: UploadedLog, t: number) {
    const { name, shipTypeId } = label
    if (name === null || shipTypeId == null) return
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

  function resolve(label: Counterparty, side: number, t: number, observer: UploadedLog): EntityKey {
    const { name, raw, shipType, shipTypeId } = label
    const shipOnly = name === null && shipTypeId != null
    const character = name !== null
      ? named(name)
      : shipOnly
        ? uniqueCandidate(ships.get(shipTypeId)?.get(side), t, observer)
        : null
    const shipName = shipTypeId == null ? undefined : meta.names[shipTypeId]?.name
    const key = character
      ? charKey(character.charId)
      : shipOnly
        ? `ship:${shipTypeId}:${side}` as const
        : `name:${name ?? raw}` as const
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
    addShip(entity, shipType ?? shipName)
    return key
  }

  return { resolve }
}
