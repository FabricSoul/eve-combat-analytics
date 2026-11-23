import type { Analysis, BattleSummary, SideSubject, TeamMember } from '@/core/contract'
import { affiliationOf } from '../battle/roster/affiliation'
import { fmtNum } from './format'

/** A side's largest named affiliation and its total number of identified pilots. */
export function sideName(side: number, summary: BattleSummary, analysis: Analysis): string {
  if (side < 0) return '未分边'

  const pilots = new Map<number, string>()
  for (const entity of Object.values(analysis.entities)) {
    if (entity.side === side && entity.charId !== null) pilots.set(entity.charId, entity.name)
  }

  function memberName(member: TeamMember) {
    const id = Number(member.slice(member.indexOf(':') + 1))
    return summary.meta.names[id]?.name
  }

  const groups = new Map<TeamMember, { name: string; pilots: number }>()
  for (const id of pilots.keys()) {
    const affiliation = affiliationOf(summary, id)
    if (!affiliation) continue
    const alliance: TeamMember | null = affiliation.allyId === null ? null : `ally:${affiliation.allyId}`
    const corporation: TeamMember = `corp:${affiliation.corpId}`
    const member = alliance && memberName(alliance) ? alliance : corporation
    const existing = groups.get(member)
    if (existing) existing.pilots++
    else {
      const name = memberName(member)
      if (name) groups.set(member, { name, pilots: 1 })
    }
  }

  const largest = [...groups.values()].sort((a, b) => b.pilots - a.pilots || a.name.localeCompare(b.name))[0]
  const brName = summary.meta.teams[side]?.map(memberName).find(Boolean)
  const name = largest?.name ?? [...pilots.values()].sort()[0] ?? brName ?? `第 ${side + 1} 方`
  if (pilots.size === 0) return name
  if (pilots.size === 1) return `${name} · 1 人`
  return `${name} 等 ${fmtNum(pilots.size)} 人`
}

export function sideOrder(analysis: Analysis, oursSide: number): number[] {
  const sides = analysis.coverage.filter(({ side }) => side >= 0 && side !== oursSide)
    .sort((a, b) => b.known - a.known || a.side - b.side)
    .map(({ side }) => side)
  return oursSide < 0 ? sides : [oursSide, ...sides]
}

const colors = ['var(--color-side-0)', 'var(--color-side-1)', 'var(--color-side-2)']

export function sideColor(side: number, order: readonly number[]): string {
  return (side >= 0 ? colors[order.indexOf(side)] : undefined) ?? 'var(--color-side-n)'
}

export function sideLetter(side: number, order: readonly number[]): string | null {
  if (side < 0) return null
  let index = order.indexOf(side)
  if (index < colors.length) return null
  let letter = ''
  for (; index >= 0; index = Math.floor(index / 26) - 1) {
    letter = String.fromCharCode(65 + index % 26) + letter
  }
  return letter
}

export function defaultOursSide(summary: BattleSummary): number {
  const counts = summary.meta.teams.map(() => 0)
  const uploaders = new Set<number>()
  const overrides = new Map(summary.sideOverrides.map(({ subject, side }) => [subject, side]))
  const affiliations = new Map(Object.values(summary.names).flatMap((value) => value ? [[value.charId, value] as const] : []))
  for (const log of summary.logs) {
    if (uploaders.has(log.charId)) continue
    uploaders.add(log.charId)
    const affiliation = affiliations.get(log.charId)
    const corpId = affiliation?.corpId
    const allyId = affiliation?.allyId
    const overriddenSide = (subject: SideSubject) => overrides.get(subject)
    const side = overriddenSide(`char:${log.charId}`)
      ?? (corpId == null ? undefined : overriddenSide(`corp:${corpId}`))
      ?? (allyId == null ? undefined : overriddenSide(`ally:${allyId}`))
      ?? log.side
    const count = counts[side]
    if (count !== undefined) counts[side] = count + 1
  }
  return counts.reduce((winner, count, side) => count > (counts[winner] ?? 0) ? side : winner, 0)
}
