import itemTypes from './item-types.json'

type ItemTuple = [id: number, en: string, zh: string | null]

const typeIds = new Map<string, number>()
const ambiguous = new Set<string>()

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
  for (const name of [en, zh]) {
    if (!name) continue
    const key = normalize(name)
    if (!key) continue
    if (ambiguous.has(key)) continue

    const existing = typeIds.get(key)
    if (existing !== undefined && existing !== id) {
      typeIds.delete(key)
      ambiguous.add(key)
    } else {
      typeIds.set(key, id)
    }
  }
}

/**
 * Resolves a weapon, module, charge, drone or fighter name (en or zh) to its CCP type ID.
 * Case-insensitive, strips trailing asterisks (`*`) commonly found in Chinese localized logs.
 *
 * Returns null if the name cannot be resolved or is ambiguous (maps to multiple type IDs).
 */
export function itemTypeId(name: string): number | null {
  if (!name) return null
  const key = normalize(name)
  if (!key || ambiguous.has(key)) return null
  return typeIds.get(key) ?? null
}

/** True for an exact catalog label, including names shared by multiple IDs. */
export function isItemTypeName(name: string): boolean {
  const key = normalize(name)
  return typeIds.has(key) || ambiguous.has(key)
}
