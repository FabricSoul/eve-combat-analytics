import { expect, it } from 'vitest'
import leshak from '../../../fixtures/real/j125990-20250622/killmail-128067587.json'
import typeNames from '../data/killmail-types.json'
import { killmailToEft } from './killmail-eft'

it('converts Blanchard2213’s Leshak with loaded charges and combined drone stacks', () => {
  expect(killmailToEft(leshak, typeNames)).toEqual({
    killmailId: 128067587,
    charId: 2121605780,
    shipTypeId: 47271,
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
