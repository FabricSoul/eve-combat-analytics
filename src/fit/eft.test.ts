import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { EftFormatError, parseEft, selectDroneStacks } from './eft'

const fixture = (name: string) =>
  readFileSync(new URL(`../../etl/parity/${name}.eft`, import.meta.url), 'utf8')

describe('parseEft', () => {
  it('parses a Hurricane Fleet Issue with loaded artillery and an offline gun', () => {
    const fit = parseEft(fixture('hurricane'))
    expect(fit).toMatchObject({ ship: 'Hurricane Fleet Issue', name: 'Synthetic fleet artillery' })
    expect(fit.modules.filter(({ name }) => name === '720mm Howitzer Artillery II')).toEqual([
      ...Array.from({ length: 5 }, () => ({
        name: '720mm Howitzer Artillery II', charge: 'Republic Fleet EMP M', offline: false,
      })),
      { name: '720mm Howitzer Artillery II', charge: 'Republic Fleet EMP M', offline: true },
    ])
    expect(fit.modules.map(({ name }) => name)).not.toContain('Nanite Repair Paste')
    const drones = new Set(['Warrior II', 'Hornet EC-300'])
    expect(selectDroneStacks(fit.stacks, (name) => drones.has(name))).toEqual([
      { name: 'Warrior II', count: 5 },
      { name: 'Hornet EC-300', count: 5 },
    ])
  })

  it('parses a Scimitar with remote repairers, CRLF and a BOM', () => {
    const fit = parseEft('\uFEFF' + fixture('scimitar').replaceAll('\n', '\r\n'))
    expect(fit.ship).toBe('Scimitar')
    expect(fit.modules.filter(({ name }) => name === 'Large Remote Shield Booster II')).toEqual([
      ...Array.from({ length: 3 }, () => ({ name: 'Large Remote Shield Booster II', offline: false })),
      { name: 'Large Remote Shield Booster II', offline: true },
    ])
  })

  it('skips empty slots and identifies drones among mixed quantified rows', () => {
    const fit = parseEft(`[Tristan, Scout, a [spare]]
[Empty Low slot]
Small Armor Repairer II /OFFLINE

Hobgoblin II x5
Nanite Repair Paste x100`)
    expect(fit.name).toBe('Scout, a [spare]')
    expect(fit.modules).toEqual([{ name: 'Small Armor Repairer II', offline: true }])
    expect(selectDroneStacks(fit.stacks, (name) => name === 'Hobgoblin II')).toEqual([
      { name: 'Hobgoblin II', count: 5 },
    ])
  })

  it('leaves drones packed alongside cargo in the hold when a drone bay is present', () => {
    const fit = parseEft('[Tristan, Scout]\n\nHobgoblin II x5\n\nWarrior II x2\nNanite Repair Paste x100')
    expect(selectDroneStacks(fit.stacks, (name) => name.endsWith(' II'))).toEqual([
      { name: 'Hobgoblin II', count: 5 },
    ])
  })

  it.each([
    '', '[Scimitar]', '[Scimitar, ]', '[, Fleet logistics]', 'message\n[Oracle, Fleet pulse]',
    '[Oracle, Fleet pulse]\nMega Pulse Laser II,', '[Oracle, Fleet pulse]\n[Oracle, Another fit]',
    '[Tristan, Scout]\nHobgoblin II x0', '[Tristan, Scout]\nHobgoblin II x9007199254740992',
    '[Scimitar, Fleet logistics]\nShield Extender II /online',
  ])('gives malformed EFT a typed API error (%j)', (input) => {
    expect(() => parseEft(input)).toThrow(EftFormatError)
    expect(() => parseEft(input)).toThrow(expect.objectContaining({ code: 'bad_eft' }))
  })
})
