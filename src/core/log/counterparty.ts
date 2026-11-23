import type { Counterparty } from '../contract'

// These are complete, structurally distinct overview layouts. In particular,
// "word [TICK]" can mean a ship-only label, or a pilot followed by a corp.
const pilotFirst = /^(?<name>[^()[\]<>]+?)\s*(?:\[(?<corp>[A-Za-z0-9._'\-]{1,5})\]\s*)?(?:\[(?<alliance>[A-Za-z0-9._'\-]{1,5})\]\s*)?\((?<ship>[^()[\]<>]+)\)$/
const corpFirst = /^\[([A-Za-z0-9._'\-]{1,5})\]\s*([^()[\]<>]+)$/
const shipFirst = /^([^()[\]<>]+?)\s*\[([^()[\]<>]+)\]$/
const couldBeTicker = /^[A-Z0-9._'\-]{1,5}$/
const hasDecoration = /[()[\]<>]/

export function counterparty(label: string, raw: string): Counterparty {
  const result: Counterparty = {
    raw,
    name: null,
    corpTicker: null,
    allianceTicker: null,
    shipTypeId: null,
    shipType: null,
  }

  const decorated = pilotFirst.exec(label)?.groups
  if (decorated?.name && decorated.ship && !couldBeTicker.test(decorated.ship.trim())) {
    return {
      ...result,
      name: decorated.name.trim(),
      corpTicker: decorated.corp ?? null,
      allianceTicker: decorated.alliance ?? null,
      shipType: decorated.ship.trim(),
    }
  }

  const prefixed = corpFirst.exec(label)
  if (prefixed?.[2]?.trim()) {
    return { ...result, name: prefixed[2].trim(), corpTicker: prefixed[1] ?? null }
  }

  const bracketed = shipFirst.exec(label)
  const bracketName = bracketed?.[2]?.trim()
  if (bracketed?.[1] && bracketName && !couldBeTicker.test(bracketName)) {
    return { ...result, name: bracketName, shipType: bracketed[1].trim() }
  }

  if (!hasDecoration.test(label)) result.name = label
  return result
}
