import { readFileSync } from 'node:fs'
import { realLogTexts } from '../../../fixtures/real/j125990-20250622/load'
import { describe, expect, it } from 'vitest'
import type { Counterparty } from '../contract'
import shipTypes from '../data/ship-types.json'
import { parseGamelog } from './parse'

function party(raw: string, name: string | null, shipType: string | null, shipTypeId: number | null,
  corpTicker: string | null = null, allianceTicker: string | null = null): Counterparty {
  return { raw, name, shipType, shipTypeId, corpTicker, allianceTicker }
}

const en = new URL('../../../fixtures/logs/en-overview-sample.txt', import.meta.url)
const zh = new URL('../../../fixtures/logs/zh-overview-sample.txt', import.meta.url)

describe('dictionary-backed overview labels', () => {
  it('separates English ship-first, pilot-first, and angle-bracket formats', () => {
    const result = parseGamelog(readFileSync(en, 'utf8'))
    expect(result.unparsed).toEqual([])
    expect(result.events.slice(0, 5).map(({ other }) => other)).toEqual([
      party('Bhaalgorn [ALY] [C57] Reed Vesper', 'Reed Vesper', 'Bhaalgorn', 17920, 'C57', 'ALY'),
      party('Maris Sol [C57] (ALY)Leshak', 'Maris Sol', 'Leshak', 47271, 'C57', 'ALY'),
      party("Vey R'not [C57]<ALY>(Absolution)", "Vey R'not", 'Absolution', 22448, 'C57', 'ALY'),
      party('Leshak <Kestrel One>', 'Kestrel One', 'Leshak', 47271),
      party('Hurricane Nox [C57]<ALY>(Hurricane Fleet Issue)', 'Hurricane Nox', 'Hurricane Fleet Issue', 33157, 'C57', 'ALY'),
    ])
  })

  it('keeps the longest type and handles asterisk, fused and custom Chinese labels', () => {
    const result = parseGamelog(readFileSync(zh, 'utf8'))
    expect(result.unparsed).toEqual([])
    expect(result.events.slice(0, 7).map(({ other }) => other)).toEqual([
      party('勒沙克级* [WISP] [C57] Kite-in-Dusk 7', 'Kite-in-Dusk 7', 'Leshak', 47271, 'C57', 'WISP'),
      party('Kite-in-Dusk 7勒沙克级*', 'Kite-in-Dusk 7', 'Leshak', 47271),
      party('Root Copper纪念碑级*', 'Root Copper', 'Cenotaph', 85086),
      party("Vos Tar'len[WISP]'[HA] Absolution - midnight'(救赎级*)", "Vos Tar'len", 'Absolution', 22448, null, 'WISP'),
      party("Vos Tar'len 奉献级* <WISP>", "Vos Tar'len", 'Devoter', 12017, null, 'WISP'),
      party('涅斯托级* [WISP] [250MM] Vera Moon', 'Vera Moon', '涅斯托级', 33472, '250MM', 'WISP'),
      party('帝国海军监护官*', null, '帝国海军监护官', 31868),
    ])
  })

  it('keeps the source and target of third-party warp attempts in both languages', () => {
    const english = parseGamelog(readFileSync(en, 'utf8')).events
    const chinese = parseGamelog(readFileSync(zh, 'utf8')).events
    expect(english.slice(5, 7)).toEqual([
      {
        kind: 'ewar_seen', ewar: 'warp_scramble', line: 10, t: Date.UTC(2025, 5, 22, 15, 38, 6),
        source: party('Leshak', null, 'Leshak', 47271),
        other: party('Bhaalgorn', null, 'Bhaalgorn', 17920),
      },
      {
        kind: 'ewar_seen', ewar: 'warp_disrupt', line: 11, t: Date.UTC(2025, 5, 22, 15, 38, 7),
        source: party("Devoter [ALY] [C57] [Rook V'orn-7] -", "Rook V'orn-7", 'Devoter', 12017, 'C57', 'ALY'),
        other: party('Cenotaph [END] [MOON] [Vale Oriel]', 'Vale Oriel', 'Cenotaph', 85086, 'MOON', 'END'),
      },
    ])
    expect(chinese.slice(7, 9)).toEqual([
      {
        kind: 'ewar_seen', ewar: 'warp_scramble', line: 12, t: Date.UTC(2025, 5, 22, 15, 38, 8),
        source: party("奉献级* [WISP] [C57] Vos Tar'len -", "Vos Tar'len", '奉献级', 12017, 'C57', 'WISP'),
        other: party('纪念碑级* [END] [MOON] Root Copper -', 'Root Copper', '纪念碑级', 85086, 'MOON', 'END'),
      },
      {
        kind: 'ewar_seen', ewar: 'warp_disrupt', line: 13, t: Date.UTC(2025, 5, 22, 15, 38, 9),
        source: party("Vos Tar'len[WISP]'[HA] Dune'(奉献级*)", "Vos Tar'len", '奉献级', 12017, null, 'WISP'),
        other: party("Root Copper[END]'北灯'(纪念碑级*)", 'Root Copper', '纪念碑级', 85086, null, 'END'),
      },
    ])
  })

  it('parses verified combat-channel ECM variants from the real corpus', () => {
    const english = parseGamelog(readFileSync(en, 'utf8')).events
    const chinese = parseGamelog(readFileSync(zh, 'utf8')).events
    expect(english.slice(-2)).toMatchObject([
      { kind: 'ewar', dir: 'out', ewar: 'jam', other: { name: "Rook V'orn-7" } },
      { kind: 'ewar', dir: 'in', ewar: 'jam', other: { name: "Rook V'orn-7" } },
    ])
    expect(chinese[9]).toMatchObject({ kind: 'ewar', dir: 'in', ewar: 'jam', other: { name: "Vos Tar'len" } })
  })

  it('keeps the canonical drone type when a drone miss names its owner', () => {
    const result = parseGamelog(readFileSync(zh, 'utf8'))
    expect(result.events.at(-1)).toMatchObject({
      kind: 'miss', dir: 'in',
      other: party('Root Copper的帝国海军监护官*', 'Root Copper', 'Imperial Navy Curator', 31868),
    })
  })

  it('uses ship words as names when there is no overview hull position', () => {
    const header = readFileSync(en, 'utf8').split('\n').slice(0, 4).join('\n')
    const result = parseGamelog(header + '\n' + [
      '[ 2025.06.22 15:38:01 ] (combat) 44 from Moss Hurricane Flint - Hits',
      '[ 2025.06.22 15:38:02 ] (combat) 44 from Moss Hurricane Flint [C57] ( Leshak ) - Hits',
      '[ 2025.06.22 15:38:03 ] (combat) 44 from Experimental Vessel <Moss Flint> - Hits',
      '[ 2025.06.22 15:38:04 ] (combat) 44 from Moss Flint [C57](分裂者级测试船M*) - Hits',
      '[ 2025.06.22 15:38:05 ] (combat) 44 from 分裂者级测试船M* - Hits',
    ].join('\n'))
    expect(result.events.map(({ other }) => other)).toEqual([
      party('Moss Hurricane Flint', 'Moss Hurricane Flint', null, null),
      party('Moss Hurricane Flint [C57] ( Leshak )', 'Moss Hurricane Flint', 'Leshak', 47271, 'C57'),
      party('Experimental Vessel <Moss Flint>', 'Moss Flint', 'Experimental Vessel', null),
      party('Moss Flint [C57](分裂者级测试船M*)', 'Moss Flint', '分裂者级测试船M', null, 'C57'),
      party('分裂者级测试船M*', '分裂者级测试船M', null, null),
    ])
  })
})

it('keeps real English and Chinese smartbomb rocket hits as unnamed projectile targets', () => {
  const texts = realLogTexts()
  const cases = [
    { file: '20250622_122835_2117427381.txt', weapon: 'Dread Guristas Large Graviton Smartbomb' },
    { file: '20250622_123828_2115160605.txt', weapon: 'Imperial Navy Large EMP Smartbomb' },
  ]
  for (const { file, weapon } of cases) {
    const { text } = texts.find((log) => log.file === file)!
    const line = text.split(/\r\n|\n|\r/).findIndex((raw) => raw.includes('Caldari Navy Mjolnir Rocket')
      && raw.includes('[NVACA]') && raw.includes(weapon)) + 1
    expect(line).toBeGreaterThan(0)
    const event = parseGamelog(text).events.find((entry) => entry.line === line)
    expect(event).toMatchObject({
      kind: 'damage', dir: 'out', amount: 90, weapon,
      other: { raw: expect.stringContaining('[NVACA]'), name: null, shipType: null, shipTypeId: null },
    })
  }
}, 60_000)

it('keeps the real rocket weapon separate from the pilot flying the Cenotaph', () => {
  const { text } = realLogTexts().find(({ file }) => file === '20250622_144910_94105136.txt')!
  const rocketLine = text.split(/\r\n|\n|\r/).findIndex((line) => line.includes('Tallanvor[NVACA](Cenotaph)')
    && line.includes(' - Caldari Navy Mjolnir Rocket - Hits')) + 1
  expect(rocketLine).toBeGreaterThan(0)
  const event = parseGamelog(text).events.find(({ line }) => line === rocketLine)
  expect(event).toMatchObject({
    kind: 'damage', dir: 'in', weapon: 'Caldari Navy Mjolnir Rocket',
    other: { name: 'Tallanvor', shipType: 'Cenotaph', shipTypeId: 85086 },
  })
}, 60_000)

it('rejects known equipment as a hull in legacy overview syntax without hiding real pilots named Rocket', () => {
  const header = readFileSync(en, 'utf8').split('\n').slice(0, 4).join('\n')
  const result = parseGamelog(header + '\n' + [
    '[ 2025.06.22 15:38:01 ] (combat) 44 from Dread Guristas Large Graviton Smartbomb <Rocket> - Hits',
    '[ 2025.06.22 15:38:02 ] (combat) 44 from Rocket [NVACA] (Cenotaph) - Hits',
  ].join('\n'))
  expect(result.events.map(({ other }) => other)).toMatchObject([
    { name: null, shipType: null, shipTypeId: null },
    { name: 'Rocket', shipType: 'Cenotaph', shipTypeId: 85086 },
  ])
})

it('separates the real color-marked hulls glued to pilot names in J125990', () => {
  const { text } = realLogTexts().find(({ file }) => file === '20250622_151020_2121908518.txt')!
  const parsed = parseGamelog(text)
  for (const [name, shipType, shipTypeId] of [
    ['Raisen Urli Itinen', 'Bhaalgorn', 17920], ['Verstaphen 23', 'Arazu', 11969],
    ['Venjanen Houra Itinen', 'Zirnitra', 52907],
  ] as const) {
    const line = text.split(/\r\n|\n|\r/).findIndex((raw) =>
      raw.includes(`${name}<color="0xffFF3300">${shipType}</color>`)) + 1
    expect(line).toBeGreaterThan(0)
    expect(parsed.events.find((event) => event.line === line)?.other)
      .toMatchObject({ raw: expect.stringContaining(name + shipType), name, shipType, shipTypeId })
  }
}, 60_000)

it('keeps real drone and charge targets separate from pilot names', () => {
  const cases = [
    { file: '20250622_123828_2115160605.txt', label: 'hint="Acolyte II"', shipType: 'Acolyte II' },
    { file: '20250622_123828_2115160605.txt', label: 'hint="Warden II"', shipType: 'Warden II' },
    { file: '20250622_123828_2115160605.txt', label: '高级鱼雷*[NVACA]', shipType: null },
    { file: '20250622_123828_2115160605.txt', label: '节日弹药*[NVACA]', shipType: null },
    { file: '20250622_122835_2117427381.txt', label: 'Hornet EC-300[NVACA](Hornet EC-300)', shipType: 'Hornet EC-300' },
    { file: '20250622_132108_2122585545.txt', label: 'hint="Republic Fleet Bouncer"', shipType: 'Republic Fleet Bouncer' },
    { file: '20250622_132108_2122585545.txt', label: '圣甲虫分裂者级逃生舱*[H-CAT]', shipType: null },
  ]
  const logs = realLogTexts()
  for (const { file, label, shipType } of cases) {
    const { text } = logs.find((log) => log.file === file)!
    const line = text.split(/\r\n|\n|\r/).findIndex((raw) =>
      raw.includes(label) && /(?:Smartbomb|立体炸弹)/.test(raw)) + 1
    expect(line).toBeGreaterThan(0)
    expect(parseGamelog(text).events.find((event) => event.line === line)?.other)
      .toMatchObject({ name: null, shipType })
  }
}, 60_000)

function escapeRegex(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

it('resolves dictionary ships and known listeners in the 17 real PvP logs (fixtures/real/j125990-20250622)', () => {
  const texts = realLogTexts()
  const files = texts.map((t) => t.file)
  const logs = texts.map((t) => parseGamelog(t.text))
  const events = logs.flatMap(({ events }) => events)
  const weapons = new Set(events.flatMap((event) => 'weapon' in event && event.weapon ? [event.weapon] : []))
  expect(weapons.size).toBe(30)
  expect([...weapons].filter((weapon) => weapon.includes(') - ') || weapon.includes('*)'))).toEqual([])
  const unparsed = logs.reduce((sum, log) => sum + log.unparsed.length, 0)
  expect(files).toHaveLength(17)
  expect(events.length + unparsed).toBe(107_365)
  expect(unparsed).toBe(0)
  expect(events.filter((event) => event.kind === 'ewar_seen').length).toBeGreaterThan(3_000)

  const parties = events.flatMap((event) => event.kind === 'ewar_seen' ? [event.other, event.source] : [event.other])
  const rawLabels = new Set(parties.map(({ raw }) => raw))
  const typeNames = [...new Set(shipTypes.flatMap(({ en, zh }) => [en, zh]))].filter(Boolean)
  const latin = typeNames.filter((name) => !/\p{Script=Han}/u.test(name)).map(escapeRegex).join('|')
  const localized = typeNames.filter((name) => /\p{Script=Han}/u.test(name)).map(escapeRegex).join('|')
  const dictionary = new RegExp(`(?<![a-zA-Z0-9])(?:${latin})(?![a-zA-Z0-9])|(?:${localized})(?![\\p{L}\\p{N}])`, 'u')
  const marked = new Set([...rawLabels].filter((raw) => dictionary.test(raw)))
  expect(marked.size).toBeGreaterThan(700)
  const missingTypes = new Set(
    parties.filter(({ raw, shipTypeId }) => marked.has(raw) && shipTypeId === null).map(({ raw }) => raw),
  )
  expect(missingTypes.size).toBe(0)

  const listeners = logs.map(({ listener }) => listener).sort((a, b) => b.length - a.length)
  const pilotToken = new RegExp(`(?<![a-zA-Z0-9])(?:${listeners.map(escapeRegex).join('|')})(?![a-zA-Z0-9])`, 'i')
  const spelling = new Map(listeners.map((name) => [name.toLowerCase(), name]))
  const knownNames = new Map<string, string>()
  for (const raw of rawLabels) {
    const name = raw.match(pilotToken)?.[0]
    const listener = name && spelling.get(name.toLowerCase())
    if (listener) knownNames.set(raw, listener)
  }
  const mismatches = new Set(
    parties.filter(({ raw, name }) => knownNames.has(raw) && name !== knownNames.get(raw)).map(({ raw }) => raw),
  )
  expect(new Set(knownNames.values()).size).toBe(17)
  expect(mismatches.size).toBe(0)
}, 30_000)
