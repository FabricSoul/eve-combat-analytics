import type { BattleMeta, Killmail } from '../contract'
import { type RawKm, killmailOf } from './normalize'
import { inferTeams } from './teams'

const HOUR = 3_600_000
const MARGIN = 15 * 60_000

/** Raw GET br.evetools.org/newapi/br/related/<systemId>/<YYYYMMDDHHMM>, as observed 2026-11-22. */
export interface RawRelated {
  result: string
  datetime: string
  systemID: number
  system: { id: number; name: string; region: string; ss: string | number }
  kms: RawKm[]
}

/**
 * BattleMeta for a related link. The API covers `time − 1 h … time + 2 h`; the one window is the killmails'
 * first..last ±15 min clipped to that. Teams are inferred from who shot whom.
 */
export function normalizeBrRelated(
  raw: RawRelated,
  key: string,
  time: number,
  names: BattleMeta['names'],
  fetchedAt: number,
): BattleMeta {
  const seen = new Set<number>()
  const killmails: Killmail[] = []
  for (const k of raw.kms) {
    if (seen.has(k.id)) continue
    seen.add(k.id)
    killmails.push(killmailOf(k))
  }
  killmails.sort((a, b) => a.t - b.t || a.id - b.id)
  const first = killmails[0]!.t
  const last = killmails[killmails.length - 1]!.t
  return {
    brId: key,
    source: 'br.evetools.related',
    fetchedAt,
    windows: [
      {
        systemId: raw.systemID,
        systemName: raw.system.name,
        regionName: raw.system.region,
        security: Number(raw.system.ss),
        start: Math.max(first - MARGIN, time - HOUR),
        end: Math.min(last + MARGIN, time + 2 * HOUR),
      },
    ],
    teams: inferTeams(killmails),
    killmails,
    names,
  }
}
