import type { ParseBrUrl } from '../contract'

const ID = /^[0-9a-f]{24}$/i
const BR_PATH = /^\/br\/([0-9a-f]{24})\/?$/i
const RELATED_PATH = /^\/related\/(\d{1,15})\/(\d{12})\/?$/
const RELATED_KEY = /^related-(\d{1,15})-(\d{12})$/
const BR_HOSTS = new Set(['br.evetools.org', 'www.br.evetools.org'])
const ZKILL_HOSTS = new Set(['zkillboard.com', 'www.zkillboard.com'])

/** A positive integer system id and a real UTC minute (YYYYMMDDHHMM), or null. */
function relatedKey(system: string, stamp: string): string | null {
  const systemId = Number(system)
  if (!Number.isSafeInteger(systemId) || systemId <= 0) return null
  const y = Number(stamp.slice(0, 4))
  const mo = Number(stamp.slice(4, 6))
  const d = Number(stamp.slice(6, 8))
  const h = Number(stamp.slice(8, 10))
  const mi = Number(stamp.slice(10, 12))
  const date = new Date(Date.UTC(y, mo - 1, d, h, mi))
  const real =
    date.getUTCFullYear() === y && date.getUTCMonth() === mo - 1 && date.getUTCDate() === d &&
    date.getUTCHours() === h && date.getUTCMinutes() === mi
  return real ? `related-${systemId}-${stamp}` : null
}

/** `related-<systemId>-<YYYYMMDDHHMM>` split into its parts, or null if it is not such a key (or not a real minute). */
export function parseRelatedKey(key: string): { systemId: number; stamp: string; time: number } | null {
  const m = RELATED_KEY.exec(key)
  if (!m || relatedKey(m[1]!, m[2]!) !== key) return null
  const s = m[2]!
  return {
    systemId: Number(m[1]),
    stamp: s,
    time: Date.UTC(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)), Number(s.slice(8, 10)), Number(s.slice(10, 12))),
  }
}

/**
 * Battle key from a br.evetools.org/br/<id> link, a bare 24-hex id, or a br.evetools / zkillboard
 * `/related/<systemId>/<YYYYMMDDHHMM>` link; otherwise null.
 */
export const parseBrUrl: ParseBrUrl = (input) => {
  const s = input.trim()
  if (ID.test(s)) return s.toLowerCase()
  let u: URL
  try {
    u = new URL(s)
  } catch {
    return null
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null
  if (BR_HOSTS.has(u.hostname)) {
    const m = BR_PATH.exec(u.pathname)
    if (m) return m[1]!.toLowerCase()
  }
  if (BR_HOSTS.has(u.hostname) || ZKILL_HOSTS.has(u.hostname)) {
    const m = RELATED_PATH.exec(u.pathname)
    if (m) return relatedKey(m[1]!, m[2]!)
  }
  return null
}
