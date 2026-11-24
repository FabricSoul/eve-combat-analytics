import type { EntityKey, Interaction, PilotStats } from '@/core/contract'

const qualities = [
  { key: 'Wrecks', label: '致命一击', strength: 100 },
  { key: 'Smashes', label: '强力一击', strength: 80 },
  { key: 'Penetrates', label: '穿透', strength: 62 },
  { key: 'Hits', label: '命中', strength: 45 },
  { key: 'Glances Off', label: '擦过', strength: 30 },
  { key: 'Grazes', label: '轻轻擦过', strength: 30 },
] as const

export const hitQualityHint = '命中率按日志中记录了质量的命中和明确的未命中计算。只统计报告命中信息的炮塔、无人机或导弹等武器。立体炸弹和部分效果可能没有命中质量记录。'
export const noHitQualityReason = '这段时间没有带命中信息的射击'

type HitCounts = Pick<PilotStats, 'hitQuality' | 'misses'>

export function hitRate(counts: HitCounts): number | null {
  const hits = qualities.reduce((total, { key }) => total + (counts.hitQuality[key] ?? 0), 0)
  const shots = hits + counts.misses
  return shots > 0 ? hits / shots : null
}

export function hitSegments(counts: HitCounts) {
  const segments = [
    ...qualities.map((quality) => ({ ...quality, count: counts.hitQuality[quality.key] ?? 0 })),
    { key: 'miss', label: '未命中', strength: 0, count: counts.misses },
  ]
  const total = segments.reduce((sum, { count }) => sum + count, 0)
  return segments.filter(({ count }) => count > 0)
    .map((segment) => ({ ...segment, share: segment.count / total }))
}

export function topHitWeapons(interactions: readonly Interaction[], key: EntityKey) {
  const weapons = new Map<string, HitCounts>()
  for (const { from, kind, weapon, quality } of interactions) {
    if (from !== key) continue
    const outcome = kind === 'miss' ? 'miss' : kind === 'damage' && quality !== 'none' ? quality : null
    if (outcome === null) continue
    const name = weapon ?? '未记录武器'
    const counts = weapons.get(name) ?? { hitQuality: {}, misses: 0 }
    if (outcome === 'miss') counts.misses++
    else counts.hitQuality[outcome] = (counts.hitQuality[outcome] ?? 0) + 1
    weapons.set(name, counts)
  }
  return [...weapons].map(([name, counts]) => ({
    name,
    rate: hitRate(counts),
    shots: counts.misses + Object.values(counts.hitQuality).reduce((sum, count) => sum + count, 0),
  })).sort((a, b) => b.shots - a.shots || a.name.localeCompare(b.name)).slice(0, 5)
}
