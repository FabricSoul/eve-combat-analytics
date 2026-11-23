import type { Affiliation, BattleMeta, ParseGamelog } from '../core/contract'
import type { Env } from './index'

export interface Services {
  parseGamelog: ParseGamelog
  fetchBattleMeta(brId: string): Promise<BattleMeta>
  namesToCharacters(names: string[]): Promise<Record<string, number | null>>
  affiliations(charIds: number[]): Promise<Affiliation[]>
  now(): number
}

export function createServices(_env: Env): Services {
  throw new Error('not wired')
}
