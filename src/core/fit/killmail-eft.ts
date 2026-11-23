import type { KillmailFit } from '../contract'

interface EsiKillmailItem {
  flag: number
  item_type_id: number
  quantity_destroyed?: number
  quantity_dropped?: number
}

/** The fields of the public ESI response needed to reconstruct a fit. */
export interface EsiKillmail {
  killmail_id: number
  victim: {
    character_id?: number
    ship_type_id: number
    items?: EsiKillmailItem[]
  }
}

interface TypeNames {
  items: Readonly<Record<number, string>>
  charges: Readonly<Record<number, string>>
  mutated?: readonly number[]
}

const DRONE_BAY = 87
const racks = [
  { first: 11, size: 8, label: 'Low' },
  { first: 19, size: 8, label: 'Med' },
  { first: 27, size: 8, label: 'High' },
  { first: 92, size: 3, label: 'Rig' },
  { first: 125, size: 4, label: 'Subsystem' },
] as const

export function killmailToEft(km: EsiKillmail, typeNames: TypeNames): KillmailFit {
  const { killmail_id: killmailId, victim } = km
  const { ship_type_id: shipTypeId, character_id: charId = null } = victim
  const ship = typeNames.items[shipTypeId]
  if (!ship) throw new Error(`Missing EFT name for EVE hull type ${shipTypeId}`)
  const sections = [`[${ship}, Killmail ${killmailId}]`]
  const slots = new Map<number, { module?: { id: number; name: string }; charge?: string }>()
  const drones = new Map<number, { name: string; count: number }>()
  const substitutedIds = new Set(typeNames.mutated)
  const mutated = new Set<string>()
  const skippedTypeIds = new Set<number>()

  for (const { flag, item_type_id: id, quantity_destroyed, quantity_dropped } of victim.items ?? []) {
    if (flag === DRONE_BAY) {
      const name = typeNames.items[id]
      if (!name) {
        skippedTypeIds.add(id)
        continue
      }
      const quantity = (quantity_destroyed ?? 0) + (quantity_dropped ?? 0)
      if (quantity > 0) drones.set(id, { name, count: (drones.get(id)?.count ?? 0) + quantity })
    } else if (racks.some(({ first, size }) => flag >= first && flag < first + size)) {
      const slot = slots.get(flag) ?? {}
      const charge = typeNames.charges[id]
      const module = typeNames.items[id]
      if (charge) slot.charge = charge
      else if (module) slot.module = { id, name: module }
      else skippedTypeIds.add(id)
      slots.set(flag, slot)
    }
  }

  for (const { first, size, label } of racks) {
    const lines: string[] = []
    let filled = 0
    for (let i = 0; i < size; i++) {
      const slot = slots.get(first + i)
      if (slot?.module) {
        const { id, name } = slot.module
        if (substitutedIds.has(id)) mutated.add(name)
        lines.push(slot.charge ? `${name}, ${slot.charge}` : name)
        filled = i + 1
      } else {
        lines.push(`[Empty ${label} slot]`)
      }
    }
    if (filled) sections.push(lines.slice(0, filled).join('\n'))
  }

  if (drones.size) {
    const lines: string[] = []
    for (const [id, { name, count }] of drones) {
      if (substitutedIds.has(id)) mutated.add(name)
      lines.push(`${name} x${count}`)
    }
    sections.push(lines.join('\n'))
  }
  return { killmailId, charId, shipTypeId, eft: sections.join('\n\n'), mutated: [...mutated], skippedTypeIds: [...skippedTypeIds] }
}
