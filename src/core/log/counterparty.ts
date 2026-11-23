import type { Counterparty } from '../contract'
import { isItemTypeName, itemTypeId } from '../data/item-types'
import shipTypes from '../data/ship-types.json'

const typeIds = new Map<string, number>()
const englishTypes = new Set<string>()
const shipTypeIds = new Set(shipTypes.map(({ id }) => id))
for (const { id, en, zh } of shipTypes) {
  if (en) {
    englishTypes.add(en)
    typeIds.set(en, id)
  }
  if (zh) typeIds.set(zh, id)
}

export function isEnglishShipType(name: string): boolean {
  return englishTypes.has(name)
}

/** Item labels can describe objects hit by smartbombs, but never their pilots or hulls. */
export function isEquipmentType(name: string): boolean {
  if (typeIds.has(name)) return false
  const id = itemTypeId(name)
  return id === null ? isItemTypeName(name) : !shipTypeIds.has(id)
}

interface ShipPrefix {
  children?: Map<string, ShipPrefix>
  type?: { name: string; id: number }
}

// A prefix index scans a short overview label without trying every hull name.
const shipNames: ShipPrefix = {}
for (const [name, id] of typeIds) {
  let node = shipNames
  for (const letter of name.split('')) {
    const children = (node.children ??= new Map())
    let next = children.get(letter)
    if (!next) {
      next = {}
      children.set(letter, next)
    }
    node = next
  }
  node.type = { name, id }
}

const han = /\p{Script=Han}/u
const unicodeWord = /[\p{L}\p{N}]/u
const latinWord = /[A-Za-z0-9]/
const ticker = /^[A-Z0-9._'\-]{1,5}$/
const decoration = /[()[\]<>]/
const groupPattern = /\[([^\[\]]+)\]|<([^<>]+)>|\(([^()]+)\)/g
const groupsOnly = /^(?:\s*(?:\[[^\[\]]+\]|<[^<>]+>|\([^()]+\)))*\s*$/

interface ShipToken {
  name: string
  id: number
  start: number
  end: number
  wrapped: boolean
  rank: number
}

function findShip(label: string): ShipToken | undefined {
  let best: ShipToken | undefined
  for (let start = 0; start < label.length; start++) {
    let node = shipNames.children?.get(label.charAt(start))
    const previous = label.charAt(start - 1)
    for (let end = start + 1; node; end++) {
      const type = node.type
      if (type) {
        const marked = label[end] === '*'
        const after = marked ? end + 1 : end
        const next = label.charAt(after)
        const bounded = han.test(type.name)
          ? marked || !unicodeWord.test(next)
          : !latinWord.test(previous) && (marked || !latinWord.test(next))
        if (bounded) {
          const left = label.slice(0, start).trimEnd()
          const right = label.slice(after).trimStart()
          const wrapped = left.endsWith('(') && right.startsWith(')')
          // A hull field and a localization marker both outweigh ship
          // words that happen to appear in the pilot or cosmetic name.
          const rank = wrapped ? 3 : marked ? 2 : groupsOnly.test(left) || groupsOnly.test(right) ? 1 : 0
          if (rank && (!best || rank > best.rank || (rank === best.rank && type.name.length > best.name.length))) {
            best = {
              ...type,
              start: wrapped ? left.length - 1 : start,
              end: wrapped ? label.length - right.length + 1 : after,
              wrapped, rank,
            }
          }
        }
      }
      node = node.children?.get(label.charAt(end))
    }
  }
  return best
}

function withoutCustomName(prefix: string): { prefix: string; hadCustomName: boolean } {
  if (!prefix.endsWith("'")) return { prefix, hadCustomName: false }
  // A recognizable ticker before the opening quote survives even when the
  // cosmetic name has apostrophes or bracket groups of its own.
  const markedQuote = /\[[A-Z0-9._'-]{1,5}\]'/.exec(prefix)
  const opening = markedQuote ? markedQuote.index + markedQuote[0].length - 1 : prefix.lastIndexOf("'", prefix.length - 2)
  return opening < 0
    ? { prefix, hadCustomName: false }
    : { prefix: prefix.slice(0, opening).trim(), hadCustomName: true }
}

function fieldsAroundShip(before: string, after: string, wrapped: boolean): Pick<Counterparty, 'name' | 'corpTicker' | 'allianceTicker'> {
  const shipFirst = !before
  const { prefix, hadCustomName } = wrapped ? withoutCustomName(before) : { prefix: before, hadCustomName: false }
  const rest = (prefix + ' ' + after).trim()
  const square: string[] = []
  const bracketNames: string[] = []
  let allianceTicker: string | null = null
  let badGroup = false
  let end = 0
  const words: string[] = []
  for (const match of rest.matchAll(groupPattern)) {
    words.push(rest.slice(end, match.index))
    end = match.index + match[0].length
    const value = (match[1] ?? match[2] ?? match[3] ?? '').trim()
    if (match[1] && ticker.test(value) && square.length < 2) square.push(value)
    else if ((match[2] || match[3]) && ticker.test(value)) allianceTicker ??= value
    else if (shipFirst && !match[3]) bracketNames.push(value)
    else badGroup = true
  }
  words.push(rest.slice(end))
  const bare = words.map((word) => word.trim()).filter(Boolean).join(' ')
  const boxed = bracketNames.length === 1 ? bracketNames[0] : undefined
  const candidate = bare && !bracketNames.length ? bare : !bare ? boxed : undefined
  const name = candidate && !badGroup && !decoration.test(candidate) ? candidate : null
  let corpTicker = square[0] ?? null
  if (!allianceTicker && square.length === 2) {
    allianceTicker = shipFirst ? square[0] ?? null : square[1] ?? null
    corpTicker = shipFirst ? square[1] ?? null : corpTicker
  } else if (!allianceTicker && hadCustomName) {
    allianceTicker = corpTicker
    corpTicker = null
  }
  return { name, corpTicker, allianceTicker }
}

// Fallback for older/localized hull spellings absent from the CCP dictionary.
const legacyHull = /^(?<name>[^()[\]<>]+?)\s*(?:\[(?<corp>[A-Za-z0-9._'-]{1,5})\]\s*)?(?:(?:\[(?<square>[A-Za-z0-9._'-]{1,5})\]|<(?<angle>[A-Za-z0-9._'-]{1,5})>)\s*)?\((?<ship>[^()[\]<>]+)\)$/
const corpFirst = /^\[([A-Za-z0-9._'-]{1,5})\]\s*([^()[\]<>]+)$/
const legacyShipFirst = /^([^()[\]<>]+?)\s*(?:\[([^()[\]<>]+)\]|<([^()[\]<>]+)>)$/

export function counterparty(label: string, raw: string, drone?: string, npcName?: string): Counterparty {
  const result: Counterparty = {
    raw,
    name: npcName ?? null,
    corpTicker: null,
    allianceTicker: null,
    shipType: null,
    shipTypeId: null,
  }
  const droneType = drone?.trim().replace(/\*$/, '')
  const droneId = droneType && typeIds.get(droneType)
  if (droneId) {
    result.shipType = droneType ?? null
    result.shipTypeId = droneId
  }
  if (npcName) return isEquipmentType(npcName) ? { ...result, name: null } : result
  // A leading italic run is a pilot label in a real overview layout.
  // Italics after the hull are cosmetic and can contain bracket groups.
  const clean = label.replace(/^<i>([^<>]+)<\/i>/, '$1')
    .replace(/<i>[^]*?<\/i>/g, ' ').trim().replace(/(?:\s+-)+$/, '')
  // A target such as Rocket[NVACA](Caldari Navy Mjolnir Rocket) is the projectile,
  // not a character named after it. Check the whole type field before scanning prefixes.
  const wrappedType = /\(([^()]+)\)$/.exec(clean)?.[1]
  const bracketed = legacyShipFirst.exec(clean)
  if (isEquipmentType(wrappedType ?? bracketed?.[1] ?? clean)) return result
  const ship = findShip(clean)
  if (ship) {
    return {
      ...result,
      ...fieldsAroundShip(clean.slice(0, ship.start).trim(), clean.slice(ship.end).trim(), ship.wrapped),
      shipType: ship.name,
      shipTypeId: ship.id,
    }
  }

  if (label.includes('<i>')) return result
  const legacy = legacyHull.exec(clean)?.groups
  if (legacy?.name && legacy.ship && !ticker.test(legacy.ship.trim())) {
    return {
      ...result,
      name: legacy.name.trim(),
      corpTicker: legacy.corp ?? null,
      allianceTicker: legacy.square ?? legacy.angle ?? null,
      shipType: legacy.ship.trim().replace(/\*$/, ''),
    }
  }
  const prefix = corpFirst.exec(clean)
  if (prefix?.[2]?.trim()) return { ...result, name: prefix[2].trim(), corpTicker: prefix[1] ?? null }

  const bracketName = (bracketed?.[2] ?? bracketed?.[3])?.trim()
  if (bracketed?.[1] && bracketName && !ticker.test(bracketName)) {
    return { ...result, name: bracketName, shipType: bracketed[1].trim().replace(/\*$/, '') }
  }
  if (!decoration.test(clean)) result.name = clean.replace(/\*$/, '') || null
  return result
}
