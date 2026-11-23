import type { BattleMeta } from '@/core/contract'

export function battleTitle({ brId, windows }: Pick<BattleMeta, 'brId' | 'windows'>): string {
  const systems = [...new Set(windows.map(({ systemName }) => systemName))]
  const first = systems[0]
  if (first === undefined) return brId
  return systems.length > 1 ? `${first} 等 ${systems.length} 个星系` : first
}
