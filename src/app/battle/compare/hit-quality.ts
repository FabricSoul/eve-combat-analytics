import type { HitQuality, Interaction, PilotStats } from '@/core/contract'

const qualities = [
  { key: 'Wrecks', label: '致命一击', strength: 100 },
  { key: 'Smashes', label: '强力一击', strength: 80 },
  { key: 'Penetrates', label: '穿透', strength: 62 },
  { key: 'Hits', label: '命中', strength: 45 },
  { key: 'Glances Off', label: '擦过', strength: 30 },
  { key: 'Grazes', label: '轻轻擦过', strength: 30 },
] as const satisfies readonly { key: Exclude<HitQuality, 'none'>; label: string; strength: number }[]

export const hitQualityScale = [
  ...qualities,
  { key: 'miss', label: '未命中', strength: 0 },
] as const

export const hitQualityHint = '命中率按日志中记录了质量的命中和明确的未命中计算。只统计报告命中信息的炮塔、无人机或导弹等武器。立体炸弹和部分效果可能没有命中质量记录。'
export const noHitQualityReason = '这段时间没有带命中信息的射击'

export type HitCounts = Pick<PilotStats, 'hitQuality' | 'misses'>

export function hitRate(counts: HitCounts): number | null {
  const hits = qualities.reduce((total, { key }) => total + (counts.hitQuality[key] ?? 0), 0)
  const shots = hits + counts.misses
  return shots > 0 ? hits / shots : null
}

export function hitSegments(counts: HitCounts) {
  const segments = hitQualityScale.map((quality) => ({
    ...quality,
    count: quality.key === 'miss' ? counts.misses : counts.hitQuality[quality.key] ?? 0,
  }))
  const total = segments.reduce((sum, { count }) => sum + count, 0)
  return segments.filter(({ count }) => count > 0)
    .map((segment) => ({ ...segment, share: segment.count / total }))
}

export type HitOutcome = typeof qualities[number]['key'] | 'miss'

export function hitOutcome({ kind, quality }: Interaction): HitOutcome | null {
  return kind === 'miss' ? 'miss' : kind === 'damage' && quality !== 'none' ? quality : null
}
