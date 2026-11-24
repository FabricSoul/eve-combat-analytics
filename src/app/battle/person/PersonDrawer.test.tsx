// @vitest-environment jsdom
import { resolve } from 'node:path'
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { runnerImport } from 'vite'
import { expect, it } from 'vitest'
import { analyze } from '@/core/analysis/analyze'
import type { BattleState } from '@/core/contract'
import { itemTypeGroup } from '@/core/data/item-types'
import { BattleProvider } from '../../state/battle-store'
import { useView, ViewProvider } from '../../state/view-store'
import { loadUiFixture } from '../../test/ui-fixture'
import { PersonDrawer } from '../PersonDrawer'
import { PilotActions } from '../roster/PilotActions'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('opens a selected pilot, toggles replay focus, expands, and closes with its button', () => {
  const fixture = loadUiFixture()
  const pilot = Object.values(fixture.analysis.entities).find(({ name }) => name === 'MoQingXL moqing')!
  const host = document.createElement('div')
  const root = createRoot(host)
  function Harness() {
    const { select, selected, focusOnly } = useView()
    useEffect(() => { select(pilot.key) }, [])
    return <><output>{String(focusOnly)}</output>{selected && <PersonDrawer />}</>
  }
  try {
    act(() => root.render(
      <BattleProvider static={fixture}><ViewProvider syncUrl={false}><Harness /></ViewProvider></BattleProvider>,
    ))
    expect(host.querySelector('h2')?.textContent).toContain(pilot.name)
    expect(host.textContent).toContain('维修给了谁')
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="只看他的回放"]')!.click())
    expect(host.querySelector('output')?.textContent).toBe('true')
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="展开整页"]')!.click())
    expect(host.querySelector('button[aria-label="还原抽屉"]')).not.toBeNull()
    act(() => host.querySelector<HTMLButtonElement>('button[aria-label="关闭个人详情"]')!.click())
    expect(host.querySelector('h2')).toBeNull()
  } finally {
    act(() => root.unmount())
  }
})

it('keeps repair green while damage bars follow side and aggregate damage stays neutral', () => {
  const fixture = loadUiFixture()
  const pilot = Object.values(fixture.analysis.entities).find(({ name }) => name === 'MoQingXL moqing')!
  const host = document.createElement('div')
  const root = createRoot(host)
  function Harness() {
    const { select, setOursSide } = useView()
    useEffect(() => { select(pilot.key) }, [])
    return <><button className="flip" onClick={() => setOursSide(0)}>Flip</button><PersonDrawer /></>
  }
  try {
    act(() => root.render(
      <BattleProvider static={fixture}><ViewProvider syncUrl={false} defaultSide={1}><Harness /></ViewProvider></BattleProvider>,
    ))
    const attackerList = [...host.querySelectorAll('section')].find((section) =>
      section.querySelector('h3')?.textContent === '谁对他造成伤害（前 5）')!
    const bar = (name: string) => [...attackerList.querySelectorAll('.u7-person-top')].find((row) =>
      row.querySelector('button')?.textContent === name)!.querySelector('i')!.style.background
    const repairList = [...host.querySelectorAll('section')].find((section) =>
      section.querySelector('h3')?.textContent === '维修给了谁（前 5）')!
    const repairColors = () => [...repairList.querySelectorAll<HTMLElement>('.u7-top-track i')]
      .map((track) => track.style.background)
    expect(repairColors().length).toBeGreaterThan(0)
    expect(new Set(repairColors())).toEqual(new Set(['var(--color-repair)']))
    expect(host.querySelectorAll('.u7-series polyline')[0]?.getAttribute('stroke')).toBe('var(--color-repair)')
    expect(bar('zethx')).toBe('var(--color-side-1)')
    expect(bar('Blanchard2213')).toBe('var(--color-side-0)')
    act(() => host.querySelector<HTMLButtonElement>('.flip')!.click())
    expect(new Set(repairColors())).toEqual(new Set(['var(--color-repair)']))
    expect(bar('zethx')).toBe('var(--color-side-0)')
    expect(bar('Blanchard2213')).toBe('var(--color-side-1)')
    expect(host.querySelectorAll('.u7-series polyline')[1]?.getAttribute('stroke')).toBe('var(--color-side-n)')
  } finally {
    act(() => root.unmount())
  }
})

it('shows hit rate, team median, quality counts, and observed weapon breakdown for a selected uploader', () => {
  const fixture = loadUiFixture({ fullPilotEvents: true })
  const pilot = Object.values(fixture.analysis.entities).find(({ name }) => name === 'Blanchard2213')!
  const host = document.createElement('div')
  const root = createRoot(host)
  function Harness() {
    const { select } = useView()
    useEffect(() => { select(pilot.key) }, [])
    return <PersonDrawer />
  }
  try {
    act(() => root.render(
      <BattleProvider static={fixture}><ViewProvider syncUrl={false} defaultSide={1}><Harness /></ViewProvider></BattleProvider>,
    ))
    const tile = [...host.querySelectorAll('.u7-stat-tile')].find((el) => el.querySelector('h3')?.textContent === '命中率')!
    expect.soft(tile?.textContent ?? '').toContain('90%')
    expect.soft(tile?.textContent ?? '').toMatch(/有数据的 \d+ 人中位/)
    const breakdown = [...host.querySelectorAll('section')].find((el) => el.querySelector('h3')?.textContent === '命中质量')!
    expect(breakdown?.textContent).toContain('184')
    const ungraded = breakdown?.querySelector('.hit-ungraded')
    expect(ungraded?.textContent).toBe('无命中质量（立体炸弹、破袭等）726 发')
    expect(ungraded?.getAttribute('title')).toContain('排名样本')
    const rankRows = breakdown.querySelectorAll('.hit-person-ranks > div')
    expect(rankRows).toHaveLength(4)
    expect(rankRows[0]?.textContent).toContain('90%')
    expect(rankRows[0]?.textContent).toMatch(/同阵营.*第.*发.*全场.*第.*发/)
    const weaponRates = [...breakdown.querySelectorAll('.u7-hit-weapon')].map((el) => el.textContent)
    expect(weaponRates).toEqual(expect.arrayContaining([
      expect.stringMatching(/Veles Supratidal Entropic Disintegrator.*88%/),
      expect.stringMatching(/Imperial Navy Curator.*91%/),
    ]))
    expect(breakdown?.textContent).toContain('立体炸弹')
  } finally {
    act(() => root.unmount())
  }
})

it('labels observed pilots 据我方日志 and shows their numbers instead of —', () => {
  const base = loadUiFixture()
  const pilot = Object.values(base.analysis.entities).find((e) => e.charId !== null && !e.hasLog)!
  const fixture = {
    ...base,
    analysis: { ...base.analysis, stats: base.analysis.stats.map((s) => s.key === pilot.key ? { ...s, source: 'observed' as const, damageOut: 12_345 } : s) },
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  function Harness() {
    const { select } = useView()
    useEffect(() => { select(pilot.key) }, [])
    return <PersonDrawer />
  }
  try {
    act(() => root.render(<BattleProvider static={fixture}><ViewProvider syncUrl={false}><Harness /></ViewProvider></BattleProvider>))
    expect(host.querySelector('.u7-person-header')?.textContent).toContain('据我方日志')
    const tiles = [...host.querySelectorAll('.u7-stat-tile')].map((t) => t.textContent)
    expect(tiles[0]).toContain('12,345')
    // 维修反应 needs his own log: still —, with the reason on hover.
    const reaction = [...host.querySelectorAll('.u7-stat-tile')].find((t) => t.textContent?.includes('维修反应'))!
    expect(reaction.querySelector('.app-number')?.textContent).toBe('—')
    expect(reaction.querySelector('.app-number')?.getAttribute('title')).toContain('自己的战斗日志')
  } finally {
    act(() => root.unmount())
  }
})

it('labels the observed enemy hit sample in the tile, breakdown and ranks', () => {
  const base = loadUiFixture()
  const pilot = base.analysis.entities['char:2120391968']!
  expect(pilot.name).toBe('Kohera Hakomairos')
  expect(pilot.hasLog).toBe(false)
  const fixture = {
    ...base,
    // The archived counters predate the observed source field. The shots are real excerpted events.
    analysis: { ...base.analysis, stats: base.analysis.stats.map((s) => s.key === pilot.key ? { ...s, source: 'observed' as const } : s) },
  }
  const host = document.createElement('div')
  const root = createRoot(host)
  function Harness() {
    const { select } = useView()
    useEffect(() => { select(pilot.key) }, [])
    return <PersonDrawer />
  }
  try {
    act(() => root.render(<BattleProvider static={fixture}><ViewProvider defaultSide={1} syncUrl={false}><Harness /></ViewProvider></BattleProvider>))
    const tile = [...host.querySelectorAll('.u7-stat-tile')].find((el) => el.querySelector('h3')?.textContent === '命中率')
    expect(tile?.querySelector('.app-number')?.textContent).toBe('100%')
    expect(tile?.textContent).toContain('据我方日志')
    expect(tile?.textContent).toContain('35 发')
    const breakdown = [...host.querySelectorAll('.u7-person-card')].find((el) => el.querySelector('h3')?.textContent === '命中质量')
    expect(breakdown?.textContent).toContain('据我方日志')
    expect(breakdown?.querySelector('.hit-classes')?.textContent).toContain('35 发 · 100%')
    expect(breakdown?.querySelector('.u7-hit-weapon')?.textContent).toContain('Veles Supratidal Entropic Disintegrator')
    expect(breakdown?.querySelector('[aria-label="命中排名"]')?.textContent).toContain('35 发')
  } finally {
    act(() => root.unmount())
  }
})

it('describes the output median using only teammates with measured output', () => {
  const base = loadUiFixture()
  const pilot = base.analysis.entities['char:2121605780']!
  // An unidentified entity with activity is still outside the same-side pilot population.
  const unidentified = { ...pilot, key: 'ship:47271:1' as const, charId: null, name: 'Leshak', hasLog: false }
  const fixture = { ...base, analysis: { ...base.analysis,
    entities: { ...base.analysis.entities, [unidentified.key]: unidentified },
    stats: [...base.analysis.stats, { ...base.analysis.stats[0]!, key: unidentified.key, source: 'observed' as const, damageOut: 1 }],
  } }
  const host = document.createElement('div')
  const root = createRoot(host)
  function Harness() {
    const { select } = useView()
    useEffect(() => { select(pilot.key) }, [select])
    return <PersonDrawer />
  }
  try {
    act(() => root.render(<BattleProvider static={fixture}><ViewProvider defaultSide={1} syncUrl={false}><Harness /></ViewProvider></BattleProvider>))
    const tile = [...host.querySelectorAll('.u7-stat-tile')].find((t) => t.querySelector('h3')?.textContent === '输出')!
    const values = base.analysis.stats.filter((s) => base.analysis.entities[s.key]?.side === pilot.side &&
      base.analysis.entities[s.key]?.hasLog).map((s) => s.damageOut).sort((a, b) => a - b)
    const value = (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2
    const tooltip = tile.querySelector('small')
    expect(tooltip?.getAttribute('title')).toContain(`有数据的 ${values.length} 人的中位`)
    expect(tooltip?.textContent).toContain(Math.round(value).toLocaleString('en-US'))
  } finally {
    act(() => root.unmount())
  }
})

it('offers 这是谁… in the drawer of an unidentified entity and opens the picker', () => {
  const base = loadUiFixture()
  const hidden = { key: 'name:Hidden' as const, name: 'Hidden', charId: null, side: base.analysis.entities[Object.keys(base.analysis.entities)[0] as keyof typeof base.analysis.entities]!.side, sideSource: 'br' as const, shipTypes: ['Leshak'], hasLog: false }
  const fixture = { ...base, analysis: { ...base.analysis, entities: { ...base.analysis.entities, [hidden.key]: hidden } } }
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  function Harness() {
    const { select } = useView()
    useEffect(() => { select(hidden.key) }, [])
    return <PersonDrawer />
  }
  try {
    act(() => root.render(<BattleProvider static={fixture}><ViewProvider syncUrl={false}><PilotActions><Harness /></PilotActions></ViewProvider></BattleProvider>))
    const button = [...host.querySelectorAll('button')].find((b) => b.textContent === '这是谁…')!
    expect(button).toBeDefined()
    act(() => button.click())
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    const known = Object.values(base.analysis.entities).find((e) => e.charId !== null)!
    act(() => root.render(<BattleProvider static={fixture}><ViewProvider syncUrl={false}><PilotActions><SelectKnown k={known.key} /></PilotActions></ViewProvider></BattleProvider>))
    expect([...host.querySelectorAll('button')].some((b) => b.textContent === '这是谁…')).toBe(false)
  } finally {
    act(() => root.unmount())
    host.remove()
    document.querySelector('.identity-scrim')?.remove()
  }
})

function SelectKnown({ k }: { k: Parameters<ReturnType<typeof useView>['select']>[0] }) {
  const { select } = useView()
  useEffect(() => { select(k) }, [])
  return <PersonDrawer />
}

it('matches full-fight hit and repair medians independently calculated from identified teammates in J125990', async () => {
  const { module } = await runnerImport<{ realBattleStateWithBr(): BattleState }>(
    resolve('fixtures/real/j125990-20250622/load.ts'), { configFile: false },
  )
  const state = module.realBattleStateWithBr()
  const analysis = analyze(state)
  const pilot = analysis.entities['char:2121605780']!
  expect(state.logs).toHaveLength(17)
  expect(pilot.name).toBe('Blanchard2213')
  const peers = new Map(Object.values(analysis.entities)
    .filter((entity) => entity.charId !== null && entity.side === pilot.side)
    .map((entity) => [entity.key, { hits: 0, misses: 0, repairs: 0 }]))
  for (const event of analysis.interactions) {
    const totals = peers.get(event.from)
    if (!totals) continue
    if (event.kind === 'repair') totals.repairs += event.amount
    if (event.kind === 'miss') totals.misses++
    if (event.kind !== 'damage' || !event.quality || event.quality === 'none') continue
    const group = event.weapon ? itemTypeGroup(event.weapon)?.groupId : undefined
    if (group !== 72 && group !== 4807 && group !== 4808) totals.hits++
  }
  const rates = [...peers.values()].filter(({ hits, misses }) => hits + misses > 0)
    .map(({ hits, misses }) => hits / (hits + misses)).sort((a, b) => a - b)
  const repair = analysis.stats.flatMap(({ key, source }) => {
    const peer = peers.get(key)
    return peer && (analysis.entities[key]?.hasLog || source === 'observed') ? [peer.repairs] : []
  }).sort((a, b) => a - b)
  const center = (values: number[]) => (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2
  expect(new Set(rates).size).toBeGreaterThan(1)
  expect(new Set(repair).size).toBeGreaterThan(1)
  expect(rates).toHaveLength(17)
  expect(repair.filter((amount) => amount > 0)).toHaveLength(22)
  expect(repair).toContain(0)
  const own = peers.get(pilot.key)!
  expect(center(rates)).not.toBe(own.hits / (own.hits + own.misses))
  expect(center(repair)).not.toBe(own.repairs)

  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    const fixture = { summary: loadUiFixture().summary, analysis }
    const select = (key: typeof pilot.key) => {
      act(() => root.render(<BattleProvider static={fixture}><ViewProvider defaultSide={pilot.side} syncUrl={false}>
        <SelectKnown key={key} k={key} />
      </ViewProvider></BattleProvider>))
    }
    const tile = (name: string) => [...host.querySelectorAll('.u7-stat-tile')].find((tile) => tile.querySelector('h3')?.textContent === name)!
    const median = (name: string) => tile(name).querySelector('small')!
    const percent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 0 })
    select(pilot.key)
    expect(median('命中率').querySelector('.app-number')?.textContent).toBe(percent.format(center(rates)))
    expect(median('维修输出').querySelector('.app-number')?.textContent).toBe(Math.round(center(repair)).toLocaleString('en-US'))
    expect.soft(median('命中率').textContent).toContain(`有数据的 ${rates.length} 人中位`)
    expect.soft(median('维修输出').textContent).toContain(`有数据的 ${repair.length} 人中位`)
    const other = Object.values(analysis.entities).find(({ name }) => name === 'christmas moster')!
    select(other.key)
    expect(tile('命中率').querySelector('div.app-number')?.textContent).toBe('37%')
    expect(median('命中率').querySelector('.app-number')?.textContent).toBe(percent.format(center(rates)))
  } finally {
    act(() => root.unmount())
  }
}, 60_000)
