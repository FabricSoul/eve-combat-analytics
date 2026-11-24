import type { Entity } from '@/core/contract'
import { fmtNum } from '../lib/format'

export function pilotCountLabel(pilots: number, unidentified = 0): string {
  return `${fmtNum(pilots)} 人${unidentified ? ` · ${fmtNum(unidentified)} 项未识别` : ''}`
}

export function countPilots(entities: Iterable<Entity | undefined>, includeUnidentified: boolean): string {
  let pilots = 0
  let unidentified = 0
  for (const entity of entities) {
    if (!entity) continue
    if (entity.charId !== null) pilots++
    else if (includeUnidentified) unidentified++
  }
  return pilotCountLabel(pilots, unidentified)
}
