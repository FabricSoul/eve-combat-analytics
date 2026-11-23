import { describe, it, expect } from 'vitest'
import { readFileSync, statSync } from 'node:fs'
import { realLogTexts } from '../../../fixtures/real/j125990-20250622/load'
import { parseGamelog } from '../log/parse'
import { itemTypeId } from './item-types'

describe('item-types', () => {
  it('resolves known weapon/module names in English and Chinese to identical type IDs', () => {
    const smartbombEn = itemTypeId('Federation Navy Large Plasma Smartbomb')
    const smartbombZh = itemTypeId('联邦海军大型等离子立体炸弹*')
    expect(smartbombEn).toBe(15955)
    expect(smartbombZh).toBe(15955)
    expect(smartbombEn).toBe(smartbombZh)

    // Case-insensitivity and whitespace / asterisk handling
    expect(itemTypeId('federation navy large plasma smartbomb')).toBe(15955)
    expect(itemTypeId('FEDERATION NAVY LARGE PLASMA SMARTBOMB')).toBe(15955)
    expect(itemTypeId('联邦海军大型等离子立体炸弹')).toBe(15955)
    expect(itemTypeId('  联邦海军大型等离子立体炸弹**  ')).toBe(15955)

    // Negative cases
    expect(itemTypeId('')).toBeNull()
    expect(itemTypeId('   ')).toBeNull()
    expect(itemTypeId('***')).toBeNull()
    expect(itemTypeId('NonExistentModuleOrWeapon999')).toBeNull()
  })

  it('returns null for ambiguous item names that map to multiple type IDs', () => {
    // 莱塞勒氏改良型爆炸装甲增强器 is ambiguous in CCP static data between
    // typeID 15054 (Kinetic Armor Hardener) and typeID 15070 (Explosive Armor Hardener)
    expect(itemTypeId('莱塞勒氏改良型爆炸装甲增强器')).toBeNull()
    expect(itemTypeId('莱塞勒氏改良型爆炸装甲增强器*')).toBeNull()

    // Unambiguous English names for both hardeners resolve to their respective IDs
    expect(itemTypeId("Raysere's Modified Kinetic Armor Hardener")).toBe(15054)
    expect(itemTypeId("Raysere's Modified Explosive Armor Hardener")).toBe(15070)
  })

  it('keeps item-types.json within the size budget (< 1.5 MB)', () => {
    const jsonPath = new URL('item-types.json', import.meta.url)
    const stats = statSync(jsonPath)
    expect(stats.size).toBeLessThan(1.5 * 1024 * 1024)
    expect(stats.size).toBeGreaterThan(100 * 1024)

    const content = JSON.parse(readFileSync(jsonPath, 'utf8')) as unknown[]
    expect(content.length).toBeGreaterThan(5000)
  })

  it('resolves every distinct weapon and module string in the 17 real PvP logs', () => {
    const texts = realLogTexts()
    const logs = texts.map((t) => parseGamelog(t.text))
    const events = logs.flatMap((l) => l.events)

    const weapons = new Set<string>()
    const modules = new Set<string>()

    let totalWeaponEvents = 0
    let totalModuleEvents = 0

    for (const e of events) {
      if ('weapon' in e && e.weapon) {
        weapons.add(e.weapon)
        totalWeaponEvents++
      }
      if ('module' in e && e.module) {
        modules.add(e.module)
        totalModuleEvents++
      }
    }

    const allNames = new Set([...weapons, ...modules])
    const resolved = new Map<string, number>()
    const unresolved: string[] = []

    for (const name of allNames) {
      const id = itemTypeId(name)
      if (id !== null) {
        resolved.set(name, id)
      } else {
        unresolved.push(name)
      }
    }

    const resolutionRate = (resolved.size / allNames.size) * 100

    console.log(`Real logs item coverage:`)
    console.log(`  Distinct items: ${allNames.size} (weapons: ${weapons.size}, modules: ${modules.size})`)
    console.log(`  Total item event references: ${totalWeaponEvents + totalModuleEvents}`)
    console.log(`  Resolved: ${resolved.size}/${allNames.size} (${resolutionRate.toFixed(2)}%)`)
    console.log(`  Unresolved: ${unresolved.length}`)

    // 100% of distinct weapons and modules in the 17 real PvP logs resolve.
    expect(unresolved).toEqual([])
    expect(resolved.size).toBe(53)
    expect(resolutionRate).toBe(100)
  })
})
