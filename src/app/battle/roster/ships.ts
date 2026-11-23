import shipTypes from '@/core/data/ship-types.json'

const byName = new Map<string, number>()
const byId = new Map<number, string>()
for (const ship of shipTypes as { id: number; en: string; zh: string }[]) {
  byName.set(ship.en.toLowerCase(), ship.id)
  byName.set(ship.zh, ship.id)
  byId.set(ship.id, ship.en)
}

/** CCP type id of a ship shown by its English or Chinese name; null when the name is unknown. */
export function shipTypeIdByName(name: string | null | undefined): number | null {
  return name ? byName.get(name.toLowerCase()) ?? byName.get(name) ?? null : null
}

/** English name of a ship type id, or null when unknown. */
export function shipNameById(id: number | null): string | null {
  return id === null ? null : byId.get(id) ?? null
}
