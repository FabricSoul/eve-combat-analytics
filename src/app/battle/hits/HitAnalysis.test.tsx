// @vitest-environment jsdom
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { runnerImport } from 'vite'
import { expect, it } from 'vitest'
import { analyze } from '@/core/analysis/analyze'
import type { BattleState } from '@/core/contract'
import { BattleProvider } from '../../state/battle-store'
import { useView, ViewProvider } from '../../state/view-store'
import { loadUiFixture, uiReplayStart } from '../../test/ui-fixture'
import { CompareTable } from '../CompareTable'
import { HitAnalysis } from '../HitAnalysis'
import { PersonDrawer } from '../PersonDrawer'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('keeps observed and uploaded hit samples in Hits, Compare and the drawer for every 我方 side', async () => {
  const { module } = await runnerImport<{ realBattleStateWithBr(): BattleState }>(
    resolve('fixtures/real/j125990-20250622/load.ts'), { configFile: false },
  )
  const analysis = analyze(module.realBattleStateWithBr())
  const battle = { summary: loadUiFixture().summary, analysis }
  const ownSide = analysis.entities['char:2121605780']!.side
  const sides = battle.summary.meta.teams.map((_, side) => side)
  const emptySide = analysis.coverage.find(({ side, withLog }) => sides.includes(side) && withLog === 0)!.side
  const samples = [
    { key: 'char:2116097640', name: 'Dwell nowhere', shots: 1, count: '1 发', rate: '100%' },
    { key: 'char:1099648393', name: 'Neomen', shots: 123, count: '123 发', rate: '95%' },
    { key: 'char:2121605780', name: 'Blanchard2213', shots: 1854, count: '1,854 发', rate: '90%' },
  ] as const
  const host = document.createElement('div')
  const root = createRoot(host)
  function Harness() {
    const { setOursSide } = useView()
    return <>{sides.map((side) => <button key={side} data-side={side} onClick={() => setOursSide(side)}>Switch side</button>)}
      <HitAnalysis /><CompareTable /><PersonDrawer /></>
  }
  try {
    act(() => root.render(<BattleProvider static={battle}><ViewProvider defaultSide={ownSide} syncUrl={false}><Harness /></ViewProvider></BattleProvider>))
    const hitRow = (key: string) => host.querySelector<HTMLTableRowElement>(`.hit-analysis tr[data-pilot-key="${key}"]`)
    for (const side of [ownSide, ...sides.filter((side) => side !== ownSide)]) {
      act(() => host.querySelector<HTMLButtonElement>(`button[data-side="${side}"]`)!.click())
      for (const { key, name, shots, count, rate } of samples) {
        const ranked = hitRow(key)
        const insufficient = host.querySelector(`.hit-analysis .hit-insufficient li[data-pilot-key="${key}"]`)
        const compare = host.querySelector(`.u7-compare tr[data-pilot-key="${key}"]`)!
        act(() => (ranked ?? insufficient)!.querySelector<HTMLButtonElement>('.hit-pilot-name')!.click())
        const drawer = host.querySelector('.u7-person')!
        const drawerRank = drawer.querySelector('[data-hit-metric="hitRate"]')
        const drawerRate = [...drawer.querySelectorAll('.u7-stat-tile')].find((tile) => tile.querySelector('h3')?.textContent === '命中率')
        const distribution = compare.querySelector('[data-metric="hitQuality"] [role="img"]')?.getAttribute('aria-label') ?? ''
        const compareShots = [...distribution.matchAll(/ ([\d,]+)（/g)]
          .reduce((total, [, value]) => total + Number(value!.replaceAll(',', '')), 0)
        expect.soft({
          hits: [ranked?.cells[0]?.textContent?.split(' · ')[1] ?? insufficient?.querySelector('.app-number')?.textContent,
            ranked?.cells[2]?.textContent ?? insufficient?.querySelector('.hit-insufficient-coverage span:last-child .app-number')?.textContent],
          compare: [compareShots, compare.querySelector('[data-metric="hitRate"] .app-number')?.textContent],
          drawer: [drawerRank?.querySelector('dd:last-child .app-number')?.textContent?.split(' · ')[1]
            ?? drawer.querySelector('.hit-secondary .app-number')?.textContent, drawerRate?.querySelector('.app-number')?.textContent],
        }, `${name} with 我方 side ${side}`).toEqual({
          hits: [count, rate], compare: [shots, rate], drawer: [count, rate],
        })
        if (name === 'Dwell nowhere') {
          expect.soft(insufficient?.querySelector('.hit-ungraded .app-number')?.textContent).toBe('1,362')
          expect.soft(drawer.querySelector('.hit-ungraded .app-number')?.textContent).toBe('1,362')
        }
      }
    }
    act(() => host.querySelector<HTMLButtonElement>(`button[data-side="${emptySide}"]`)!.click())
    expect.soft(hitRow('char:2121605780')!.querySelector('th small')?.textContent).not.toContain('据他人日志')
    const observed = host.querySelector('.hit-analysis tr[data-pilot-key="char:2120391968"] th small') // Kohera Hakomairos
    expect.soft(observed?.textContent).toContain('我方 · 据他人日志')
    const headers = [...host.querySelectorAll('.hit-card h3')].map((header) => header.textContent.trim())
    expect.soft(headers).toContain('我方 据他人日志')
    expect.soft(headers).toContain('敌方')
  } finally {
    act(() => root.unmount())
  }
}, 60_000)

it('shows ranked samples, measured enemy coverage, filters sides and recomputes on range change', () => {
  const fixture = loadUiFixture({ fullPilotEvents: true })
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  function Harness() {
    const { setRange } = useView()
    return <><button id="minute" onClick={() => setRange([uiReplayStart, uiReplayStart + 60_000])}>Range</button><HitAnalysis /></>
  }
  try {
    act(() => root.render(<BattleProvider static={fixture}><ViewProvider defaultSide={1} syncUrl={false}><Harness /></ViewProvider></BattleProvider>))
    const view = host.querySelector('.hit-analysis')!
    expect(view.querySelector('.hit-card:nth-child(2)')?.textContent).toContain('据他人日志')
    expect(view.querySelector('.hit-trend svg')).not.toBeNull()
    expect(view.querySelector('.hit-insufficient')?.textContent).toContain('少于 30 发')
    const row = () => [...view.querySelectorAll<HTMLTableRowElement>('tbody tr')].find((el) => el.querySelector('th button')?.textContent === 'Blanchard2213')!
    expect(row().cells[0]?.textContent).toMatch(/\d+ · 1,854 发/)
    expect(row().cells[2]?.textContent).toBe('90%')
    expect(row().textContent).toContain('无命中质量 726 发')
    act(() => host.querySelector<HTMLButtonElement>('#minute')!.click())
    expect(row().cells[0]?.textContent).toMatch(/\d+ · \d+ 发/)
    expect(row().cells[2]?.textContent).not.toBe('90%')
    const previousRank = row().cells[0]?.textContent
    const enemyFilter = [...view.querySelectorAll('.hit-analysis-controls details label')].find((label) => label.textContent?.trim() === '敌方')!
    act(() => enemyFilter.querySelector<HTMLInputElement>('input')!.click())
    expect([...view.querySelectorAll('.hit-card h3')].map((heading) => heading.textContent?.trim()))
      .not.toContain('敌方 据他人日志')
    expect(row().cells[0]?.textContent).toBe(previousRank)
    expect([...view.querySelectorAll('tbody th small')].some((label) => label.textContent?.includes('敌方'))).toBe(false)
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})

it('lists a smartbomb-only pilot under 样本不足 with a dash, reason and ungraded count', () => {
  const fixture = loadUiFixture({ fullPilotEvents: true })
  const attacker = Object.values(fixture.analysis.entities).find(({ name }) => name === 'Blanchard2213')!
  const target = Object.values(fixture.analysis.entities).find(({ name }) => name === 'Lucinda HIly')!
  const template = fixture.analysis.interactions.find(({ kind }) => kind === 'damage')!
  const interactions = Array.from({ length: 35 }, () => ({
    ...template, from: attacker.key, to: target.key, quality: 'Hits' as const, weapon: 'Federation Navy Large Plasma Smartbomb',
  }))
  interactions.push(
    { ...template, from: target.key, to: attacker.key, quality: 'Hits', weapon: 'Caldari Navy Mjolnir Rocket' },
    { ...template, from: target.key, to: attacker.key, quality: 'Hits', weapon: 'Medium Breacher Pod Launcher' },
  )
  const host = document.createElement('div')
  const root = createRoot(host)
  const battle = { ...fixture, analysis: { ...fixture.analysis, interactions } }
  try {
    act(() => root.render(<BattleProvider static={battle}><ViewProvider defaultSide={attacker.side} syncUrl={false}><HitAnalysis /></ViewProvider></BattleProvider>))
    const row = [...host.querySelectorAll('.hit-insufficient li')].find((el) => el.querySelector('button')?.textContent === attacker.name)!
    expect(row?.textContent).toContain('无命中质量 35 发')
    expect(row.querySelector('[title*="没有带命中信息"]')?.textContent).toContain('—')
    expect(host.querySelector('.hit-card')?.textContent).toContain('无命中质量 36 发')
    const classRows = [...host.querySelectorAll('.hit-card .hit-classes > div')]
    const classValue = (name: string) => classRows.find((el) => el.querySelector('dt')?.textContent === name)?.querySelector('dd')?.textContent
    expect(classValue('立体炸弹')).toBe('35 发')
    expect(classValue('导弹')).toBe('2 发 · 100%（1 发样本）')
    expect(host.querySelector('tbody')).toBeNull()
  } finally {
    act(() => root.unmount())
  }
})

it('keeps the full-fight rank and sample identical in the module and drawer for every J125990 pilot', async () => {
  const { module } = await runnerImport<{ realBattleStateWithBr(): BattleState }>(
    resolve('fixtures/real/j125990-20250622/load.ts'), { configFile: false },
  )
  const analysis = analyze(module.realBattleStateWithBr())
  const battle = { summary: loadUiFixture().summary, analysis }
  expect(battle.summary.logs).toHaveLength(17)
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    act(() => root.render(<BattleProvider static={battle}><ViewProvider defaultSide={1} syncUrl={false}>
      <HitAnalysis /><PersonDrawer />
    </ViewProvider></BattleProvider>))
    const row = (key: string) => host.querySelector<HTMLTableRowElement>(`.hit-analysis tr[data-pilot-key="${key}"]`)!
    expect(row('char:2121605780').cells[0]?.textContent).toBe('27 · 1,854 发')
    expect(row('char:2118012410').cells[0]?.textContent).toBe('28 · 2,128 发')
    const filter = [...host.querySelectorAll('.hit-analysis-controls label')].find((el) => el.textContent?.trim() === '敌方')!
      .querySelector('input')!
    act(() => filter.click())
    expect(row('char:2121605780').cells[0]?.textContent).toBe('27 · 1,854 发')
    act(() => filter.click())

    const picker = host.querySelector('.hit-analysis-controls select') as unknown as HTMLSelectElement
    const rankedFor = new Map<string, Map<string, { rank: string | null; value: string | null }>>()
    for (const { value: metric } of picker.options) {
      act(() => {
        picker.value = metric
        picker.dispatchEvent(new Event('change', { bubbles: true }))
      })
      rankedFor.set(metric, new Map([...host.querySelectorAll<HTMLTableRowElement>('.hit-analysis tbody tr')]
        .map((entry) => [entry.dataset.pilotKey!, { rank: entry.cells[0]!.textContent, value: entry.cells[2]!.textContent }])))
    }
    const ranked = [...host.querySelectorAll<HTMLTableRowElement>('.hit-analysis tbody tr')]
    const insufficient = [...host.querySelectorAll('.hit-insufficient li')]
    expect(ranked.length + insufficient.length).toBe(Object.values(analysis.entities).filter(({ charId }) => charId !== null).length)
    expect(insufficient.length).toBeGreaterThan(0)
    for (const entry of insufficient) {
      const charId = entry.getAttribute('data-pilot-key')!.slice('char:'.length)
      expect(entry.querySelector('button img[width="20"][height="20"]')?.getAttribute('src'))
        .toBe(`https://images.evetech.net/characters/${charId}/portrait?size=64`)
    }
    for (const entry of ranked) {
      act(() => entry.querySelector('button')!.click())
      for (const [metric, ranks] of rankedFor) {
        const expected = ranks.get(entry.dataset.pilotKey!)!
        const drawer = host.querySelector(`.hit-person-ranks [data-hit-metric="${metric}"]`)!
        expect(drawer.querySelector('dd:last-child .app-number')?.textContent, `${entry.dataset.pilotKey} ${metric}`)
          .toBe(`第 ${expected.rank}`)
        expect(drawer.querySelector('dt .app-number')?.textContent).toBe(expected.value)
      }
    }
    for (const entry of insufficient) {
      act(() => entry.querySelector('button')!.click())
      const sample = entry.querySelector('.app-number')?.textContent
      expect(host.querySelector('.u7-person .hit-person-ranks')).toBeNull()
      expect(host.querySelector('.u7-person .hit-secondary .app-number')?.textContent).toBe(sample)
    }
  } finally {
    act(() => root.unmount())
  }
}, 60_000)

it('shows unidentified hit observations only in their own group and preserves pilot ranks', () => {
  const fixture = loadUiFixture({ fullPilotEvents: true })
  const unidentified = Object.values(fixture.analysis.entities).filter(({ charId }) => charId === null)
  const countPilots = Object.keys(fixture.analysis.entities).length - unidentified.length
  expect(unidentified.length).toBeGreaterThan(0)
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    act(() => root.render(<BattleProvider static={fixture}><ViewProvider defaultSide={1} syncUrl={false}><HitAnalysis /></ViewProvider></BattleProvider>))
    const ranked = () => [...host.querySelectorAll('.hit-analysis tbody tr')].map((row) => row.textContent)
    const before = ranked()
    expect(host.querySelector('.hit-pilot-ranks h3')?.textContent).toContain(`${countPilots} 人`)
    expect(host.querySelector('[aria-label="未识别"]')).toBeNull()
    const toggle = [...host.querySelectorAll('button')].find((button) => button.textContent === `含未识别 ${unidentified.length}`)!
    act(() => toggle.click())
    expect(ranked()).toEqual(before)
    const group = host.querySelector('[aria-label="未识别"]')
    expect(group?.querySelectorAll('li[data-pilot-key]')).toHaveLength(unidentified.length)
    const placeholders = [...group!.querySelectorAll<HTMLElement>('li button span.app-portrait[aria-hidden="true"]')]
    expect(placeholders).toHaveLength(unidentified.length)
    expect(placeholders.every(({ style }) => style.width === '20px' && style.height === '20px')).toBe(true)
    expect(group?.parentElement?.lastElementChild).toBe(group)
    expect(host.querySelector('.hit-pilot-ranks h3')?.textContent).toContain(`${countPilots} 人 · ${unidentified.length} 项未识别`)
    act(() => toggle.click())
    expect(host.querySelector('[aria-label="未识别"]')).toBeNull()
  } finally {
    act(() => root.unmount())
  }
})

it.each([
  ['no uploads', '上传带炮台、导弹或无人机的日志后会出现排名'],
  ['side filter', '调整阵营筛选'],
  ['empty range', '扩大或清除选段'],
] as const)('explains how to populate hit analysis with %s', (cause, guidance) => {
  const fixture = loadUiFixture()
  const battle = cause === 'no uploads' ? { ...fixture, summary: { ...fixture.summary, logs: [] } } : fixture
  const host = document.createElement('div')
  const root = createRoot(host)
  function Harness() {
    const { setRange } = useView()
    return <><button id="empty-range" onClick={() => {
      const end = fixture.summary.meta.killmails.at(-1)!.t
      setRange([end + 60_000, end + 120_000])
    }}>Range</button><HitAnalysis /></>
  }
  try {
    act(() => root.render(<BattleProvider static={battle}><ViewProvider defaultSide={1} syncUrl={false}><Harness /></ViewProvider></BattleProvider>))
    if (cause === 'side filter') {
      act(() => host.querySelectorAll<HTMLInputElement>('.hit-analysis-controls details input')
        .forEach((input) => input.click()))
    } else if (cause === 'empty range') {
      act(() => host.querySelector<HTMLButtonElement>('#empty-range')!.click())
    }
    expect(host.querySelector('.hit-analysis [role="status"]')?.textContent ?? '').toContain(guidance)
    expect(host.querySelector('.hit-analysis table')).toBeNull()
    if (cause === 'empty range') {
      act(() => host.querySelector<HTMLButtonElement>('.battle-range-chip')!.click())
      expect(host.querySelector('.hit-analysis tbody tr')).not.toBeNull()
    }
  } finally {
    act(() => root.unmount())
  }
})
