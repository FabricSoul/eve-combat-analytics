export interface RecentBattle {
  brId: string
  title: string
  start: number
  end: number
  kills: number
  logs: number
  openedAt: number
}

const storageKey = 'eve-combat-analytics:recent'
export const maxRecent = 20

function isRecent(value: unknown): value is RecentBattle {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return typeof entry.brId === 'string' && typeof entry.title === 'string' &&
    ['start', 'end', 'kills', 'logs', 'openedAt'].every((key) => typeof entry[key] === 'number')
}

export function readRecent(): RecentBattle[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(storageKey) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter(isRecent).slice(0, maxRecent) : []
  } catch {
    return []
  }
}

export function recordRecent(entry: RecentBattle): void {
  const list = [entry, ...readRecent().filter(({ brId }) => brId !== entry.brId)].slice(0, maxRecent)
  try {
    localStorage.setItem(storageKey, JSON.stringify(list))
  } catch {
    // Storage can be disabled or full; the list is a convenience only.
  }
}
