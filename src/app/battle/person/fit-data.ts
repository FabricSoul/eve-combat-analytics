import { createContext } from 'react'
import type { BattleSummary, EntityKey, FitEntry, Interaction } from '@/core/contract'
import { computeFitStats } from '@/fit/client'
import { api } from '../../api/client'

export interface FitCatalog {
  itemId(name: string): number | null
  moduleSlot(name: string): string
}

const slotLabels = new Map([
  [11, '低槽'], [13, '中槽'], [12, '高槽'], [2663, '改装件'], [3772, '子系统'], [6306, '服务槽'],
])
let catalog: Promise<FitCatalog> | undefined

export function loadFitCatalog(): Promise<FitCatalog> {
  return catalog ??= Promise.all([
    import('@/core/data/killmail-types.json'),
    import('./fit-items.json'),
  ]).then(([{ default: itemTypes }, { default: racks }]) => {
    const localizedItems: Readonly<Record<number, string>> = racks.localized
    const slotById: Readonly<Record<number, number>> = racks.slots
    const typeIds = new Map(
      Object.entries({ ...itemTypes.items, ...itemTypes.charges })
        .map(([id, name]) => [name, Number(id)] as const)
        .reverse()
        .concat(Object.entries(localizedItems).reverse().map(([id, name]) => [name, Number(id)] as const)),
    )
    return {
      itemId: (name: string) => typeIds.get(name) ?? null,
      moduleSlot: (name: string) => {
        const id = typeIds.get(name)
        return (id === undefined ? undefined : slotLabels.get(slotById[id] ?? 0)) ?? '其他模块'
      },
    }
  }).catch((error: unknown) => {
    catalog = undefined
    throw error
  })
}

export const FitServices = createContext({
  load: (id: number, hash: string) => api.getKillmailFit(id, hash),
  save: (...args: Parameters<typeof api.putFit>) => api.putFit(...args),
  compute: computeFitStats,
})

export function pilotFit(summary: BattleSummary, charId: number): FitEntry | undefined {
  return summary.fits.find((fit) => fit.charId === charId)
}

export function isSameFit(left: FitEntry | undefined, right: FitEntry | undefined): boolean {
  if (!left || !right || left.charId !== right.charId || left.setAt !== right.setAt || left.eft !== right.eft) return false
  const leftMutated = left.mutated ?? []
  const rightMutated = right.mutated ?? []
  return leftMutated.length === rightMutated.length && leftMutated.every((name, index) => name === rightMutated[index])
}

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
