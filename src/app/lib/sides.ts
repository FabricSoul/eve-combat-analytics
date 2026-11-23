import type { Analysis, BattleSummary, SideSubject } from '@/core/contract'

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
