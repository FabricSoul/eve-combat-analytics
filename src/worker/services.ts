import type { Affiliation, BattleMeta, ParseGamelog } from '../core/contract'
import { fetchBattleMeta } from '../core/br/fetch'
import type { EsiDeps } from '../core/esi/client'
import { affiliations, namesToCharacters } from '../core/esi/names'
import { parseGamelog } from '../core/log/parse'
import type { Env } from './index'

export interface Services {
  parseGamelog: ParseGamelog
  fetchBattleMeta(brId: string): Promise<BattleMeta>
  namesToCharacters(names: string[]): Promise<Record<string, number | null>>
  affiliations(charIds: number[]): Promise<Affiliation[]>
  now(): number
}

export interface ServiceDeps extends EsiDeps {
  now: () => number
}

const defaultDeps = (): ServiceDeps => ({
  fetch: (input, init) => fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => Date.now(),
})

/** Real services: the T1 parser and the T2 BR/ESI clients. One deps object per instance keeps ESI error-limit state. */
export function createServices(_env: Env, deps: ServiceDeps = defaultDeps()): Services {
  return {
    parseGamelog,
    fetchBattleMeta: (brId) => fetchBattleMeta(brId, deps),
    namesToCharacters: (names) => namesToCharacters(names, deps),
    affiliations: (charIds) => affiliations(charIds, deps),
    now: deps.now,
  }
}
