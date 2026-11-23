import { createContext } from 'react'
import type { ComputeFitStats, EntityKey, Interaction } from '@/core/contract'
import { computeFitStats } from '@/fit/client'
import itemTypes from '@/core/data/killmail-types.json'
import { api } from '../../api/client'
import rackData from './fit-items.json'

const localizedItems: Readonly<Record<number, string>> = rackData.localized

const typeIds = new Map(
  Object.entries({ ...itemTypes.items, ...itemTypes.charges })
    .map(([id, name]) => [name, Number(id)] as const)
    .reverse()
    .concat(Object.entries(localizedItems).reverse().map(([id, name]) => [name, Number(id)] as const)),
)
export const itemId = (name: string) => typeIds.get(name) ?? null

export const FitServices = createContext({
  load: (id: number, hash: string) => api.getKillmailFit(id, hash),
  save: (brId: string, charId: number, eft: string) => api.putFit(brId, charId, eft),
  compute: computeFitStats as ComputeFitStats,
})

export function firingSummary(interactions: readonly Interaction[], key: EntityKey) {
  const buckets = new Map<number, number>()
  const weapons = new Map<string, number>()
  const firingWindows = new Set<number>()
  for (const { from, kind, t, amount, weapon } of interactions) {
    if (from !== key || (kind !== 'damage' && kind !== 'miss')) continue
    const second = Math.floor(t / 1000)
    firingWindows.add(Math.floor(second / 10))
    buckets.set(second, (buckets.get(second) ?? 0) + amount)
    if (amount > 0) {
      const name = weapon ?? '未知武器'
      weapons.set(name, (weapons.get(name) ?? 0) + amount)
    }
  }

  if (!buckets.size) return { mean: null, peak: null, weapons: [] }
  const entries = [...buckets]
  let first = 0
  let window = 0
  let damage = 0
  let peak = 0
  for (const [second, amount] of entries) {
    window += amount
    damage += amount
    while (entries[first]![0] <= second - 10) window -= entries[first++]![1]
    peak = Math.max(peak, window / 10)
  }
  return { mean: damage / (firingWindows.size * 10), peak, weapons: [...weapons].sort((a, b) => b[1] - a[1]) }
}

const slotLabels = new Map([
  [11, '低槽'], [13, '中槽'], [12, '高槽'], [2663, '改装件'], [3772, '子系统'], [6306, '服务槽'],
])
const slotById: Readonly<Record<number, number>> = rackData.slots

export function moduleSlot(name: string): string {
  const id = itemId(name)
  return (id === null ? undefined : slotLabels.get(slotById[id] ?? 0)) ?? '其他模块'
}
