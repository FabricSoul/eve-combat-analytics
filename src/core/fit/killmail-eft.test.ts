import { expect, it } from 'vitest'
import leshak from '../../../fixtures/real/j125990-20250622/killmail-128067587.json'
import typeNames from '../data/killmail-types.json'
import { killmailToEft } from './killmail-eft'

it('converts Blanchard2213’s Leshak with loaded charges and combined drone stacks', () => {
  expect(killmailToEft(leshak, typeNames)).toEqual({
    killmailId: 128067587,
    charId: 2121605780,
    shipTypeId: 47271,
    mutated: ['Entropic Radiation Sink II'],
    skippedTypeIds: [],
    eft: [
      '[Leshak, Killmail 128067587]',
      '',
      'Coreli A-Type Multispectrum Coating',
      'Damage Control II',
      'Centum B-Type Multispectrum Energized Membrane',
      'Entropic Radiation Sink II',
      'Entropic Radiation Sink II',
      'Centii A-Type Multispectrum Coating',
      'Imperial Navy 1600mm Steel Plates',
      'Entropic Radiation Sink II',
      '',
      '500MN Cold-Gas Enduring Microwarpdrive',
      'Warp Scrambler II',
      'Sensor Booster II, Scan Resolution Script',
      'Heavy F-RX Compact Capacitor Booster, Navy Cap Booster 3200',
      '',
      'Veles Supratidal Entropic Disintegrator, Occult L',
      'Large Remote Armor Repairer II',
      'Imperial Navy Large EMP Smartbomb',
      'Large Remote Armor Repairer II',
      'Centum A-Type Medium Remote Armor Repairer',
      '',
      'Large Trimark Armor Pump I',
      'Large Trimark Armor Pump I',
      'Large EM Armor Reinforcer I',
      '',
      'Wasp II x4',
      'Warrior II x5',
    ].join('\n'),
  })
})

it('reports no substitutions when a killmail contains only ordinary fitted types', () => {
  const ordinaryFit = { ...leshak, victim: { ...leshak.victim, items: [{ flag: 12, item_type_id: 2048 }] } }
  expect(killmailToEft(ordinaryFit, typeNames).mutated).toEqual([])
})

it('skips unknown fitted and drone types while retaining the known fit and rejecting an unknown hull', () => {
  // Synthetic item IDs and inventory for the missing-data scenario.
  const ship = {
    killmail_id: 1,
    victim: {
      ship_type_id: 47271,
      items: [
        { flag: 11, item_type_id: 90000001 },
        { flag: 12, item_type_id: 2048 },
        { flag: 12, item_type_id: 90000002 },
        { flag: 87, item_type_id: 90000001, quantity_dropped: 2 },
        { flag: 87, item_type_id: 2436, quantity_destroyed: 4 },
        { flag: 5, item_type_id: 90000003 },
      ],
    },
  }
  const result = killmailToEft(ship, typeNames)
  expect(result.skippedTypeIds).toEqual([90000001, 90000002])
  expect(result.eft).toBe('[Leshak, Killmail 1]\n\n[Empty Low slot]\nDamage Control II\n\nWasp II x4')
  expect(() => killmailToEft({ ...ship, victim: { ...ship.victim, ship_type_id: 90000003 } }, typeNames))
    .toThrow('90000003')
})
