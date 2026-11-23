import type { ParseBrUrl } from '../contract'

const ID = /^[0-9a-f]{24}$/i
const PATH = /^\/br\/([0-9a-f]{24})\/?$/i

/** Accepts a br.evetools.org/br/<id> link (any common shape) or a bare 24-hex id; otherwise null. */
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
  if (u.hostname !== 'br.evetools.org' && u.hostname !== 'www.br.evetools.org') return null
  const m = PATH.exec(u.pathname)
  return m ? m[1]!.toLowerCase() : null
}
