import itemTypes from './item-types.json'

type ItemTuple = [id: number, en: string, zh: string | null]

const typeIds = new Map<string, number>()

function normalize(s: string): string {
  return s
    .trim()
    .replace(/\*+$/, '')
    .trim()
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
}

for (const [id, en, zh] of itemTypes as unknown as ItemTuple[]) {
  if (en) {
    typeIds.set(normalize(en), id)
  }
  if (zh) {
    typeIds.set(normalize(zh), id)
  }
}

/**
 * Resolves a weapon, module, charge, drone or fighter name (en or zh) to its CCP type ID.
 * Case-insensitive, strips trailing asterisks (`*`) commonly found in Chinese localized logs.
 *
 * Returns null if the name cannot be resolved.
 */
export function itemTypeId(name: string): number | null {
  if (!name) return null
  const key = normalize(name)
  if (!key) return null
  return typeIds.get(key) ?? null
}
