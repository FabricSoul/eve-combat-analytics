import type { HitQuality, InteractionKind } from '@/core/contract'
import { tracerWidth } from './layout-effects'

const qualityLevels = {
  Wrecks: [100, 1.2],
  Smashes: [80, 1],
  Penetrates: [62, 0.84],
  Hits: [45, 0.7],
  'Glances Off': [30, 0.55],
  Grazes: [30, 0.55],
  none: [100, 1],
} as const satisfies Record<HitQuality, readonly [number, number]>

const dashes = { repair: [5, 3], ewar: [2, 4], miss: [2, 4] }

export function hitTracerStyle(kind: InteractionKind, quality: HitQuality | null, strength: number) {
  const [sideShare, widthScale] = qualityLevels[quality ?? 'none']
  return {
    sideShare: kind === 'damage' ? sideShare : kind === 'miss' ? 62 : 100,
    width: kind === 'damage' ? tracerWidth(strength) * widthScale : kind === 'miss' ? 1.25 : tracerWidth(strength),
    end: kind === 'miss' ? 0.66 : 1,
    dash: kind === 'repair' || kind === 'ewar' || kind === 'miss' ? dashes[kind] : [],
    shakesTarget: kind === 'damage',
  }
}
