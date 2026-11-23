import type { Analysis, BattleSummary, SideSubject } from '@/core/contract'
import { affiliationOf } from './affiliation'
import { buildRoster, fullSideOrder, type RosterRow } from './model'

export interface SideGroup {
  /** What moving this row moves: the alliance, else the corporation, else the character alone. */
  subject: SideSubject
  kind: 'ally' | 'corp' | 'char'
  /** Alliance or corporation id (the image id); the character id for kind 'char'. */
  id: number
  name: string
  pilots: RosterRow[]
}

export interface SideColumn {
  side: number
  groups: SideGroup[]
  pilotCount: number
  withLog: number
}

export interface SideColumns {
  /** Sides in sideOrder(); one column each. */
  columns: SideColumn[]
  /** Pilots on no side (side -1), or null. */
  unassigned: SideColumn | null
  order: number[]
}

function groupPilots(summary: BattleSummary, rows: readonly RosterRow[]): SideGroup[] {
  const groups = new Map<SideSubject, SideGroup>()
  for (const row of rows) {
    const affiliation = affiliationOf(summary, row.charId)
    const [kind, id] = affiliation?.allyId != null ? ['ally', affiliation.allyId] as const
      : affiliation ? ['corp', affiliation.corpId] as const : ['char', row.charId] as const
    const subject: SideSubject = `${kind}:${id}`
    const group = groups.get(subject) ?? { subject, kind, id, name: summary.meta.names[id]?.name ?? row.name, pilots: [] }
    group.pilots.push(row)
    groups.set(subject, group)
  }
  return [...groups.values()].sort((a, b) => b.pilots.length - a.pilots.length || a.name.localeCompare(b.name))
}

export function buildSideColumns(summary: BattleSummary, analysis: Analysis, oursSide: number): SideColumns {
  const order = fullSideOrder(analysis, oursSide)
  const roster = buildRoster(summary, analysis, oursSide)
  const column = (side: number): SideColumn => {
    const rows = roster.find((group) => group.side === side)?.rows ?? []
    return { side, groups: groupPilots(summary, rows), pilotCount: rows.length, withLog: rows.filter((row) => row.hasLog).length }
  }
  const unassigned = column(-1)
  return { columns: order.map(column), unassigned: unassigned.pilotCount > 0 ? unassigned : null, order }
}

/** The side index a 新建一方 drop creates: one past every side in use. */
export function newSideIndex(summary: BattleSummary, analysis: Analysis): number {
  return Math.max(summary.meta.teams.length, ...fullSideOrder(analysis, 0).map((side) => side + 1))
}

/** Subjects with a manual override (latest wins, so each once). */
export function manualSubjects(summary: BattleSummary): SideSubject[] {
  return [...new Set(summary.sideOverrides.filter(({ source }) => source === 'manual').map(({ subject }) => subject))]
}
