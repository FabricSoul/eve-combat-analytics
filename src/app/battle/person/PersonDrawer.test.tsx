// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { BattleProvider } from '../../state/battle-store'
import { useView, ViewProvider } from '../../state/view-store'
import { loadUiFixture } from '../../test/ui-fixture'
import { PersonDrawer } from '../PersonDrawer'

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
    expect.soft(tile?.textContent ?? '').toContain('全队中位')
    const breakdown = [...host.querySelectorAll('section')].find((el) => el.querySelector('h3')?.textContent === '命中质量')!
    expect(breakdown?.textContent).toContain('184')
    expect(breakdown?.textContent).toContain('无命中质量 726 发')
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
  const host = document.createElement('div')
  const root = createRoot(host)
  function Harness() {
    const { select } = useView()
    useEffect(() => { select(pilot.key) }, [select])
    return <PersonDrawer />
  }
  try {
    act(() => root.render(<BattleProvider static={base}><ViewProvider defaultSide={1} syncUrl={false}><Harness /></ViewProvider></BattleProvider>))
    const tile = [...host.querySelectorAll('.u7-stat-tile')].find((t) => t.querySelector('h3')?.textContent === '输出')!
    const values = base.analysis.stats.filter((s) => base.analysis.entities[s.key]?.side === pilot.side &&
      base.analysis.entities[s.key]?.hasLog && s.damageOut > 0).map((s) => s.damageOut).sort((a, b) => a - b)
    const value = (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2
    const tooltip = tile.querySelector('small')
    expect(tooltip?.getAttribute('title')).toBe(`有数据的 ${values.length} 人的中位`)
    expect(tooltip?.textContent).toContain(Math.round(value).toLocaleString('en-US'))
  } finally {
    act(() => root.unmount())
  }
})
