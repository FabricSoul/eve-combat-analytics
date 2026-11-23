import { existsSync, readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { GamelogFormatError, type Counterparty, type HitQuality, type LogEvent } from '../contract'
import { parseGamelog } from './parse'

const header = [
  '------------------------------------------------------------',
  '  Gamelog',
  '  Listener: Arden Gale',
  '  Session Started: 2026.11.07 13:28:14',
  '------------------------------------------------------------',
].join('\n')
const sessionStart = Date.UTC(2026, 10, 7, 13, 28, 14)

function entry(message: string, second = '15', channel = 'combat'): string {
  return `[ 2026.11.07 13:28:${second} ] (${channel}) ${message}`
}

function log(...entries: string[]): string {
  return [header, ...entries].join('\n')
}

function party(
  raw: string,
  name: string | null = raw,
  corpTicker: string | null = null,
  allianceTicker: string | null = null,
  shipType: string | null = null,
): Counterparty {
  return { raw, name, corpTicker, allianceTicker, shipType }
}

function damage(dir: 'in' | 'out', amount: number, weapon: string | null, quality: HitQuality) {
  return { kind: 'damage', dir, amount, weapon, quality } as const
}

function miss(dir: 'in' | 'out', weapon: string | null) {
  return { kind: 'miss', dir, weapon } as const
}

type FixtureEvent = LogEvent extends infer Event
  ? Event extends LogEvent ? Omit<Event, 't' | 'line'> : never
  : never

const merin = party('Merin Vale')
const coreli = party('Coreli Initiate')
const merinRich = party('Merin Vale[COAL](Hurricane)', 'Merin Vale', 'COAL', null, 'Hurricane')
const autumn = party('秋杉')
const sentinel = party('天蛇哨兵')
const autumnRich = party('秋杉[TIDE](飓风级)', '秋杉', 'TIDE', null, '飓风级')

const enEvents: [string, FixtureEvent][] = [
  ['outgoing turret', { ...damage('out', 366, '425mm AutoCannon II', 'Hits'), other: merinRich }],
  ['incoming turret', { ...damage('in', 12, '720mm Howitzer Artillery II', 'Wrecks'), other: party('Talin Roe [CROW] [SABLE] (Muninn)', 'Talin Roe', 'CROW', 'SABLE', 'Muninn') }],
  ['incoming damage with no weapon', { ...damage('in', 5, null, 'Glances Off'), other: coreli }],
  ['ship-first label and escaped markup', { ...damage('out', 9, 'Railgun', 'Grazes'), other: party('Stabber [Alsie North]', 'Alsie North', null, null, 'Stabber') }],
  ['corp-first label', { ...damage('in', 30, 'Railgun', 'Smashes'), other: party('[COAL] Merin Vale', 'Merin Vale', 'COAL') }],
  ['label with no corp', { ...damage('out', 21, 'Railgun', 'Penetrates'), other: party('Orin Far (Ferox)', 'Orin Far', null, null, 'Ferox') }],
  ['missile and custom ship label containing separators', { ...damage('out', 200, 'Scourge Fury Heavy Missile', 'none'), other: party('Rupture Run - Run [ALL] [Alsie North]', null) }],
  ['drone with no hit quality', { ...damage('in', 80, 'Hobgoblin II', 'none'), other: party('Torin Est (Osprey)', 'Torin Est', null, null, 'Osprey') }],
  ['structure with partial deflection and system prefix', { ...damage('out', 230, 'Nova Cruise Missile', 'Hits'), other: party('J112233 - Moon & Anchor[COAL](Fortizar)', 'Moon & Anchor', 'COAL', null, 'Fortizar') }],
  ['structure with full deflection and no weapon', { ...damage('out', 0, null, 'Hits'), other: party('Long Watch[COAL](Astrahus)', 'Long Watch', 'COAL', null, 'Astrahus') }],
  ['outgoing group miss', { ...miss('out', 'Dual 180mm AutoCannon II'), other: merinRich }],
  ['outgoing single miss', { ...miss('out', 'Light Ion Blaster II'), other: coreli }],
  ['incoming bare miss', { ...miss('in', null), other: coreli }],
  ['incoming equipped miss', { ...miss('in', 'Dual 180mm AutoCannon II'), other: merinRich }],
  ['outgoing armor', { kind: 'repair', dir: 'out', repairType: 'armor', amount: 100, module: 'Medium Remote Armor Repairer II', other: merin }],
  ['incoming armor with no module', { kind: 'repair', dir: 'in', repairType: 'armor', amount: 101, module: null, other: merin }],
  ['outgoing shield', { kind: 'repair', dir: 'out', repairType: 'shield', amount: 102, module: 'Medium Remote Shield Booster II', other: coreli }],
  ['incoming shield with double dash', { kind: 'repair', dir: 'in', repairType: 'shield', amount: 103, module: 'Medium Remote Shield Booster II', other: merin }],
  ['outgoing hull', { kind: 'repair', dir: 'out', repairType: 'hull', amount: 104, module: 'Large Remote Hull Repairer II', other: merin }],
  ['incoming hull', { kind: 'repair', dir: 'in', repairType: 'hull', amount: 105, module: 'Large Remote Hull Repairer II', other: merin }],
  ['outgoing capacitor transfer', { kind: 'repair', dir: 'out', repairType: 'capacitor', amount: 106, module: 'Large Remote Capacitor Transmitter II', other: merin }],
  ['incoming capacitor transfer', { kind: 'repair', dir: 'in', repairType: 'capacitor', amount: 107, module: 'Large Remote Capacitor Transmitter II', other: merin }],
  ['outgoing neut with cyan amount', { kind: 'neut', dir: 'out', amount: 82, module: 'Medium Energy Neutralizer II', other: merin }],
  ['incoming neut with escaped red amount', { kind: 'neut', dir: 'in', amount: 61, module: 'Medium Energy Neutralizer II', other: merin }],
  ['outgoing NOS gains energy', { kind: 'nos', dir: 'out', amount: 16, module: 'Small Energy Nosferatu II', other: merin }],
  ['incoming NOS loses energy', { kind: 'nos', dir: 'in', amount: 12, module: 'Small Energy Nosferatu II', other: merin }],
  ['incoming NOS can yield zero', { kind: 'nos', dir: 'in', amount: 0, module: null, other: merin }],
  ['incoming scram', { kind: 'ewar', dir: 'in', ewar: 'warp_scramble', other: merin }],
  ['outgoing point with hyphen', { kind: 'ewar', dir: 'out', ewar: 'warp_disrupt', other: merin }],
  ['incoming point with uppercase pronoun', { kind: 'ewar', dir: 'in', ewar: 'warp_disrupt', other: merin }],
  ['outgoing scram without exclamation', { kind: 'ewar', dir: 'out', ewar: 'warp_scramble', other: merin }],
  ['terse incoming scram', { kind: 'ewar', dir: 'in', ewar: 'warp_scramble', other: coreli }],
  ['incoming ECM lock break', { kind: 'ewar', dir: 'in', ewar: 'jam', other: merin }],
  ['outgoing ECM lock break', { kind: 'ewar', dir: 'out', ewar: 'jam', other: merin }],
  ['smartbomb with no hit quality', { ...damage('out', 72, 'Large Plasma Smartbomb II', 'none'), other: merin }],
  ['drone miss keeps the printed counterparty with owner details', { ...miss('in', 'Hobgoblin II'), other: party('Hobgoblin II belonging to Merin Vale', 'Merin Vale') }],
  ['legacy quality leaves weapon intact', { ...damage('in', 42, 'Turret', 'none'), other: merin }],
  ['explicit incoming neut', { kind: 'neut', dir: 'in', amount: 43, module: 'Medium Energy Neutralizer II', other: merin }],
  ['outgoing remote energy transfer in GJ', { kind: 'repair', dir: 'out', amount: 37, repairType: 'capacitor', module: 'Remote Capacitor Transmitter II', other: merin }],
  ['incoming remote energy transfer in GJ', { kind: 'repair', dir: 'in', amount: 38, repairType: 'capacitor', module: 'Remote Capacitor Transmitter II', other: merin }],
]

const zhEvents: [string, FixtureEvent][] = [
  ['outgoing turret', { ...damage('out', 36, '425毫米自动加农炮 II', 'Hits'), other: autumnRich }],
  ['incoming turret', { ...damage('in', 22, '720毫米榴弹炮 II', 'Wrecks'), other: party('白桥 [TIDE] [HUSH] (缪宁级)', '白桥', 'TIDE', 'HUSH', '缪宁级') }],
  ['incoming damage with no weapon', { ...damage('in', 2, null, 'Glances Off'), other: sentinel }],
  ['ship-first label and adjacent tags', { ...damage('out', 9, '磁轨炮', 'Grazes'), other: party('刺客级 [迟夜星]', '迟夜星', null, null, '刺客级') }],
  ['corp-first label', { ...damage('in', 12, '磁轨炮', 'Smashes'), other: party('[TIDE] 秋杉', '秋杉', 'TIDE') }],
  ['label with no corp', { ...damage('out', 77, '磁轨炮', 'Penetrates'), other: party('暮霜 (巨鸟级)', '暮霜', null, null, '巨鸟级') }],
  ['missile and ambiguous custom ship label', { ...damage('out', 200, '雷神重型导弹', 'none'), other: party('断崖级 远夜 [ALL] [迟夜星]', null) }],
  ['structure with deflection and system prefix', { ...damage('out', 230, '巡航导弹', 'Hits'), other: party('J112233 - 深空灯塔[TIDE](铁壁)', '深空灯塔', 'TIDE', null, '铁壁') }],
  ['drone with no hit quality', { ...damage('in', 51, '地精灵 II', 'none'), other: autumn }],
  ['outgoing group miss', { ...miss('out', '磁轨炮'), other: autumnRich }],
  ['outgoing single miss', { ...miss('out', '磁轨炮'), other: autumn }],
  ['incoming equipped miss', { ...miss('in', '磁轨炮'), other: autumn }],
  ['incoming bare miss', { ...miss('in', null), other: sentinel }],
  ['outgoing armor', { kind: 'repair', dir: 'out', repairType: 'armor', amount: 20, module: '远程装甲维修器 II', other: autumn }],
  ['incoming armor', { kind: 'repair', dir: 'in', repairType: 'armor', amount: 21, module: '远程装甲维修器 II', other: autumn }],
  ['outgoing shield', { kind: 'repair', dir: 'out', repairType: 'shield', amount: 22, module: '远程护盾回充增量器 II', other: autumn }],
  ['incoming shield', { kind: 'repair', dir: 'in', repairType: 'shield', amount: 23, module: '远程护盾回充增量器 II', other: autumn }],
  ['outgoing hull', { kind: 'repair', dir: 'out', repairType: 'hull', amount: 24, module: '远程结构维修器 II', other: autumn }],
  ['incoming hull', { kind: 'repair', dir: 'in', repairType: 'hull', amount: 25, module: '远程结构维修器 II', other: autumn }],
  ['outgoing capacitor transfer', { kind: 'repair', dir: 'out', repairType: 'capacitor', amount: 26, module: '远程电容传输装置 II', other: autumn }],
  ['incoming capacitor transfer', { kind: 'repair', dir: 'in', repairType: 'capacitor', amount: 27, module: '远程电容传输装置 II', other: autumn }],
  ['outgoing neut', { kind: 'neut', dir: 'out', amount: 42, module: '中型能量中和器 II', other: autumn }],
  ['incoming neut', { kind: 'neut', dir: 'in', amount: 33, module: '中型能量中和器 II', other: autumn }],
  ['outgoing NOS', { kind: 'nos', dir: 'out', amount: 14, module: '小型掠能器 II', other: autumn }],
  ['incoming NOS', { kind: 'nos', dir: 'in', amount: 12, module: '小型掠能器 II', other: autumn }],
  ['incoming scram', { kind: 'ewar', dir: 'in', ewar: 'warp_scramble', other: autumn }],
  ['outgoing point', { kind: 'ewar', dir: 'out', ewar: 'warp_disrupt', other: autumn }],
  ['outgoing scram', { kind: 'ewar', dir: 'out', ewar: 'warp_scramble', other: autumn }],
  ['incoming point', { kind: 'ewar', dir: 'in', ewar: 'warp_disrupt', other: autumn }],
  ['smartbomb with no hit quality', { ...damage('out', 71, '大型等离子立体炸弹 II', 'none'), other: autumn }],
  ['explicit incoming neut with amount at the end', { kind: 'neut', dir: 'in', amount: 45, module: '中型能量中和器 II', other: autumn }],
  ['incoming ECM lock break with module', { kind: 'ewar', dir: 'in', ewar: 'jam', other: autumn }],
  ['incoming ECM lock break without module', { kind: 'ewar', dir: 'in', ewar: 'jam', other: sentinel }],
  ['outgoing ECM lock break', { kind: 'ewar', dir: 'out', ewar: 'jam', other: autumn }],
  ['outgoing remote energy transfer in GJ', { kind: 'repair', dir: 'out', amount: 32, repairType: 'capacitor', module: '远程电容传输装置 II', other: autumn }],
  ['incoming remote energy transfer in GJ', { kind: 'repair', dir: 'in', amount: 33, repairType: 'capacitor', module: '远程电容传输装置 II', other: autumn }],
  ['owned-drone miss in localized order', { ...miss('in', '地精灵 II'), other: party('秋杉的地精灵 II', '秋杉') }],
]

describe.each([
  { language: 'en', listener: 'Arden Gale', headerLines: 11, events: enEvents },
  { language: 'zh', listener: '林砚星', headerLines: 13, events: zhEvents },
])('$language PvP fixture', ({ language, listener, headerLines, events }) => {
  const fixture = readFileSync(new URL(`../../../fixtures/logs/${language}-pvp-sample.txt`, import.meta.url), 'utf8')
  const parse = () => parseGamelog(fixture)
  it('reads the header after comments and accounts for every entry', () => {
    const result = parse()
    expect(result).toMatchObject({ listener, sessionStart: Date.UTC(2026, 10, 7, 13, 28), language, unparsed: [] })
    expect(result.events).toHaveLength(events.length)
  })

  it.each(events.map(([form, event], index) => ({ form, event, index })))(
    'parses $form',
    ({ event, index }) => {
      expect(parse().events[index]).toEqual({
        ...event,
        line: headerLines + index + 1,
        t: Date.UTC(2026, 10, 7, 13, 28, index + 1),
      })
    },
  )
})

describe('Gamelog envelope', () => {
  it('accepts a BOM, CRLF, leading whitespace and junk, and a header-only session', () => {
    const result = parseGamelog('\uFEFF# Synthetic excerpt\r\n[Note] (example) leading junk\r\n   ' + header.replaceAll('\n', '\r\n'))
    expect(result).toEqual({ listener: 'Arden Gale', sessionStart, language: 'en', events: [], unparsed: [] })
  })

  it('accepts the alternate localized session label from the brief', () => {
    const text = header.replace('Gamelog', '游戏记录').replace('Listener:', '收听者:').replace('Session Started:', '会话开始:')
    expect(parseGamelog(text)).toMatchObject({ sessionStart, language: 'zh' })
  })

  it.each([
    ['no_header', 'Listener: Arden Gale\nSession Started: 2026.11.07 13:28:14'],
    ['no_listener', header.replace('Arden Gale', '')],
    ['no_session_start', header.replace('2026.11.07 13:28:14', '')],
    ['no_session_start', header.replace('2026.11.07', '2026.02.30')],
    ['no_session_start', header.replace('  Session Started: 2026.11.07 13:28:14\n', '') + '\n' + entry('Session Started: 2026.11.07 13:28:14')],
  ])('reports %s for an invalid header', (code, text) => {
    expect(() => parseGamelog(text)).toThrow(GamelogFormatError)
    expect(() => parseGamelog(text)).toThrow(expect.objectContaining({ code }))
  })

  it('prioritizes the heading over the language of recognized messages', () => {
    const result = parseGamelog(log(entry('8 对 秋杉 - 命中')))
    expect(result).toMatchObject({ language: 'en', events: [{ ...damage('out', 8, null, 'Hits'), other: autumn }] })
  })

  it.each([
    ['7 from Coreli Initiate - Hits', 'en'],
    ['8 对 秋杉 - 命中', 'zh'],
    ['unknown text', 'unknown'],
  ])('uses combat vocabulary when the header provides mixed language evidence (%s)', (message, language) => {
    const text = log(entry(message)).replace('Gamelog', 'Battle log').replace('  Listener:', '  收听者:')
    expect(parseGamelog(text).language).toBe(language)
  })

  it('uses a complete header after junk containing a stray heading word', () => {
    expect(parseGamelog('Gamelog\nexample follows\n' + header).listener).toBe('Arden Gale')
  })

  it('joins continuations and preserves the first physical line when sorting', () => {
    const result = parseGamelog(log(
      entry('9 to <b>Merin', '17'),
      '  Vale</b> - <font size=10>Heavy',
      '  Missile</font> - Hits',
      entry('7 from Coreli Initiate - Grazes', '15'),
      entry('9 to Coreli Initiate - Hits', '15'),
    ))
    expect(result.events).toEqual([
      { ...damage('in', 7, null, 'Grazes'), t: sessionStart + 1_000, line: 9, other: coreli },
      { ...damage('out', 9, null, 'Hits'), t: sessionStart + 1_000, line: 10, other: coreli },
      { ...damage('out', 9, 'Heavy Missile', 'Hits'), t: sessionStart + 3_000, line: 6, other: merin },
    ])
  })

  it('retains an indented overview label that begins with a square bracket', () => {
    const result = parseGamelog(log(
      entry('12 from Merin Vale'),
      '  [COAL] (Hurricane) - Hits',
      '  ' + entry('12 to Coreli Initiate - Hits'),
    ))
    expect(result.events).toEqual([
      { ...damage('in', 12, null, 'Hits'), t: sessionStart + 1_000, line: 6, other: party('Merin Vale [COAL] (Hurricane)', 'Merin Vale', 'COAL', null, 'Hurricane') },
      { ...damage('out', 12, null, 'Hits'), t: sessionStart + 1_000, line: 8, other: coreli },
    ])
  })

  it('retains unknown, incomplete, and misdated combat, and ignores non-combat', () => {
    const result = parseGamelog(log(
      entry('<b>Unknown</b>&nbsp; &amp; &lt; 5 &gt;'),
      '   more   text',
      entry('Warp disruption attempt from Merin Vale to you!', '16', 'notify'),
      '[ 2026.02.30 13:28:15 ] (combat) <b>9</b> to Coreli Initiate - Hits',
      '[ bad timestamp ] (combat) <b>unfinished</b>',
      entry('Warp scramble attempt from Merin Vale to Talin Roe!'),
      entry('41 GJ energy neutralized Coreli Initiate - Neutralizer'),
      entry(''),
      entry('8 to <i></i> - Hits'),
    ))
    expect(result.events).toEqual([])
    expect(result.unparsed).toEqual([
      { line: 6, text: 'Unknown & < 5 > more text' },
      { line: 9, text: '9 to Coreli Initiate - Hits' },
      { line: 10, text: 'unfinished' },
      { line: 11, text: 'Warp scramble attempt from Merin Vale to Talin Roe!' },
      { line: 12, text: '41 GJ energy neutralized Coreli Initiate - Neutralizer' },
      { line: 13, text: '' },
      { line: 14, text: '8 to - Hits' },
    ])
  })

  it('leaves ambiguous counterparty fields empty', () => {
    const labels = ['Loki [AB]', 'Loki [ALLY] [CORP]', 'Gale [TOOLONG] (Confessor)', 'Talin [ROE] Loki']
    const result = parseGamelog(log(...labels.map((label) => entry(`12 from <b>${label}</b> - Hits`))))
    expect(result.unparsed).toEqual([])
    expect(result.events.map(({ other }) => other)).toEqual(labels.map((label) => party(label, null)))
  })

  it('keeps literal decoded angle labels and preserves dashes inside weapon names', () => {
    const result = parseGamelog(log(entry('15 to <b>Loki &lt;AB&gt;[CORP] Arden Gale</b> - Standup - Missile - Hits')))
    expect(result.events).toEqual([{
      ...damage('out', 15, 'Standup - Missile', 'Hits'),
      t: sessionStart + 1_000,
      line: 6,
      other: party('Loki <AB>[CORP] Arden Gale', null),
    }])
  })

  it('parses 50,000 physical lines in under 1 second', () => {
    const rowCount = 50_000 - header.split('\n').length
    const text = log(...Array.from({ length: rowCount }, (_, index) => {
      const time = new Date(sessionStart + index * 1_000).toISOString()
      const stamp = time.slice(0, 10).replaceAll('-', '.') + ' ' + time.slice(11, 19)
      return `[ ${stamp} ] (combat) <color=0xff00ffff><b>366</b> <font size=10>to</font> <b>Merin Vale[COAL](Hurricane)</b> - Gun - Hits`
    }))
    const before = performance.now()
    const result = parseGamelog(text)
    const elapsed = performance.now() - before
    expect(result.events).toHaveLength(rowCount)
    expect(result.unparsed).toHaveLength(0)
    expect(elapsed).toBeLessThan(1_000)
  })
})

const pveFile = 'session-20261107-from-1942.txt'
const pvePath = [
  new URL(`../../../fixtures/local/${pveFile}`, import.meta.url),
  new URL(`../../../../revive/fixtures/local/${pveFile}`, import.meta.url),
].find(existsSync)

// Counts verified separately by stripping tags and tallying the source lines in Python.
it.skipIf(!pvePath)('accounts for all 3,075 local PvE combat entries and their totals', () => {
  if (!pvePath) return
  const { events, unparsed } = parseGamelog(readFileSync(pvePath, 'utf8'))
  const counts = {
    damage: { in: 0, out: 0 },
    damageHp: { in: 0, out: 0 },
    miss: { in: 0, out: 0 },
    repair: 0,
    neut: 0,
    nos: 0,
    ewar: 0,
  }
  for (const event of events) {
    if (event.kind === 'damage') {
      counts.damage[event.dir]++
      counts.damageHp[event.dir] += event.amount
    } else if (event.kind === 'miss') counts.miss[event.dir]++
    else counts[event.kind]++
  }
  expect(unparsed).toEqual([])
  expect(events).toHaveLength(3_075)
  expect(counts).toEqual({
    damage: { in: 774, out: 1_219 },
    damageHp: { in: 21_767, out: 153_719 },
    miss: { in: 904, out: 177 },
    repair: 0,
    neut: 0,
    nos: 0,
    ewar: 1,
  })
})
