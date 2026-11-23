import { MAX_BATTLE_SIDES } from '@/core/analysis/sides'
import type { Analysis, BattleSummary, SideSubject } from '@/core/contract'
import { sideIndexOf } from './affiliation'
import { buildRoster, fullSideOrder, type RosterRow } from './model'

export type CharRow = RosterRow & { charId: number }

export interface SideGroup {
  subject: SideSubject
  kind: 'ally' | 'corp' | 'char'
  /** Alliance or corporation id (the image id), or the character id. */
  id: number
  name: string
  pilots: CharRow[]
  corporations?: SideGroup[]
  scopeCount: number
  spansSides: boolean
}

export interface SideColumn {
  side: number
  groups: SideGroup[]
  pilotCount: number
  withLog: number
}

export interface SideColumns {
  columns: SideColumn[]
  unassigned: SideColumn | null
  order: number[]
}

interface Organization {
  count: number
  sides: Set<number>
}

export function buildSideColumns(summary: BattleSummary, analysis: Analysis, oursSide: number): SideColumns {
  const { activeSides, assignments, affiliations, manualOverrides } = sideIndexOf(summary)
  const order = fullSideOrder(analysis, oursSide).filter((side) => activeSides.has(side))
  order.push(...[...activeSides].filter((side) => !order.includes(side)).sort((a, b) => a - b))

  const rowsBySide = new Map<number, CharRow[]>()
  const organizations = new Map<SideSubject, Organization>()
  const roster = buildRoster(summary, analysis, oursSide)
  for (const { rows } of roster) {
    for (const row of rows) {
      if (row.charId === null) continue
      // Project committed moves even when the analysis that supplied the rows is older.
      const baseline = assignments.get(row.charId)?.side ?? -1
      const side = manualOverrides.get(row.charId)?.side ?? (activeSides.has(row.side) ? row.side : baseline)
      const pilot: CharRow = { ...row, charId: row.charId, side }
      const bucket = rowsBySide.get(side)
      if (bucket) bucket.push(pilot)
      else rowsBySide.set(side, [pilot])

      const { allyId, corpId } = affiliations.get(row.charId) ?? {}
      const subjects: SideSubject[] = []
      if (allyId != null) subjects.push(`ally:${allyId}`)
      if (corpId != null) subjects.push(`corp:${corpId}`)
      for (const subject of subjects) {
        const organization = organizations.get(subject) ?? { count: 0, sides: new Set() }
        organization.count++
        organization.sides.add(side)
        organizations.set(subject, organization)
      }
    }
  }

  function groupPilots(rows: readonly CharRow[], level: 'alliance' | 'corporation'): SideGroup[] {
    const groups = new Map<SideSubject, SideGroup>()
    for (const row of rows) {
      const { allyId, corpId } = affiliations.get(row.charId) ?? {}
      const [kind, id] = level === 'alliance' && allyId != null ? ['ally', allyId] as const
        : corpId != null ? ['corp', corpId] as const : ['char', row.charId] as const
      const subject: SideSubject = `${kind}:${id}`
      let group = groups.get(subject)
      if (!group) {
        const organization = organizations.get(subject)
        group = {
          subject, kind, id, name: summary.meta.names[id]?.name ?? (kind === 'char' ? row.name : String(id)), pilots: [],
          scopeCount: organization?.count ?? 1, spansSides: (organization?.sides.size ?? 1) > 1,
        }
        groups.set(subject, group)
      }
      group.pilots.push(row)
    }
    for (const group of groups.values()) {
      if (group.kind === 'ally') group.corporations = groupPilots(group.pilots, 'corporation')
    }
    return [...groups.values()].sort((a, b) => b.pilots.length - a.pilots.length || a.name.localeCompare(b.name))
  }

  const column = (side: number): SideColumn => {
    const rows = rowsBySide.get(side) ?? []
    return { side, groups: groupPilots(rows, 'alliance'), pilotCount: rows.length, withLog: rows.filter((row) => row.hasLog).length }
  }
  const unassigned = column(-1)
  return { columns: order.map(column), unassigned: unassigned.pilotCount > 0 ? unassigned : null, order }
}

/** Numeric preview of a new side, or undefined when the Worker cannot allocate one. */
export function newSideIndex(summary: BattleSummary): number | undefined {
  const { sideCount } = sideIndexOf(summary)
  return sideCount < MAX_BATTLE_SIDES ? sideCount : undefined
}

export function manualSubjects(summary: BattleSummary): SideSubject[] {
  return sideIndexOf(summary).manualSubjects
}
