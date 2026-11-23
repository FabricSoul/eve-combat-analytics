export interface RecentBattle {
  brId: string
  /** Everything but the id and open time is optional: a battle known only by its id shows no dates or counts. */
  title?: string
  start?: number
  end?: number
  kills?: number
  logs?: number
  openedAt: number
}

const storageKey = 'eve-combat-analytics:recent'
export const maxRecent = 20
const optionalNumbers = ['start', 'end', 'kills', 'logs'] as const

function isRecent(value: unknown): value is RecentBattle {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.brId === 'string' && typeof entry.openedAt === 'number' &&
    (entry.title === undefined || typeof entry.title === 'string') &&
    optionalNumbers.every((key) => entry[key] === undefined || typeof entry[key] === 'number')
}

export function readRecent(): RecentBattle[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, maxRecent) : []
  } catch {
    return []
  }
}

/** Newest first. Metadata the new entry does not carry is kept from the earlier entry for the same battle. */
export function recordRecent(entry: RecentBattle): void {
  const previous = readRecent()
  const known = Object.fromEntries(Object.entries(entry).filter(([, value]) => value !== undefined))
  const merged: RecentBattle = { ...previous.find(({ brId }) => brId === entry.brId), ...known } as RecentBattle
  const list = [merged, ...previous.filter(({ brId }) => brId !== entry.brId)].slice(0, maxRecent)
  try {
    localStorage.setItem(storageKey, JSON.stringify(list))
  } catch {
    // Storage can be disabled or full; the list is a convenience only.
  }
}
