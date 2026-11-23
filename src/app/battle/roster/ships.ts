import shipTypes from '@/core/data/ship-types.json'

const byName = new Map<string, number>()
for (const ship of shipTypes as { id: number; en: string; zh: string }[]) {
  byName.set(ship.en.toLowerCase(), ship.id)
  byName.set(ship.zh, ship.id)
}

/** CCP type id of a ship shown by its English or Chinese name; null when the name is unknown. */
export function shipTypeIdByName(name: string | null | undefined): number | null {
  return name ? byName.get(name.toLowerCase()) ?? byName.get(name) ?? null : null
}
