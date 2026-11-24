// @vitest-environment jsdom
import { resolve } from 'node:path'
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { runnerImport } from 'vite'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { analyze } from '@/core/analysis/analyze'
import { statsForRange } from '@/core/analysis/range'
import type { BattleState } from '@/core/contract'
import { BattleProvider } from '../../state/battle-store'
import { useView, ViewProvider } from '../../state/view-store'
import { loadUiFixture } from '../../test/ui-fixture'
import { CompareTable } from '../CompareTable'
import { PersonDrawer } from '../PersonDrawer'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const fixture = loadUiFixture()
let host: HTMLDivElement
let root: ReturnType<typeof createRoot>
beforeEach(() => {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  host.remove()
})

function render(children = <CompareTable />, data = fixture, defaultSide = 0, initialTime?: number) {
  act(() => root.render(
    <BattleProvider static={data}>
      <ViewProvider defaultSide={defaultSide} initialTime={initialTime} syncUrl={false}>{children}</ViewProvider>
    </BattleProvider>,
  ))
}

it('groups and sorts columns and shows a median', () => {
  render()
  for (const label of ['输出', '节奏', '承伤', '后勤', '点控']) {
    expect([...host.querySelectorAll('[scope="colgroup"]')].map((el) => el.textContent)).toContain(label)
  }
  const header = host.querySelector('[aria-sort="descending"]')!
  expect(header.textContent).toContain('输出')
  expect(host.querySelector('[title^="有数据的 "]')).not.toBeNull()
  const first = host.querySelector('tbody tr')!.textContent
  act(() => header.querySelector('button')!.click())
  expect(header.getAttribute('aria-sort')).toBe('ascending')
  expect(host.querySelector('tbody tr')!.textContent).not.toBe(first)
})

function fullFixtureWithObservedStats() {
  const data = loadUiFixture({ fullPilotEvents: true })
  const { analysis, summary } = data
  return { ...data, analysis: { ...analysis, stats: statsForRange(analysis, summary.meta.killmails, -Infinity, Infinity) } }
}

it('uses every numeric repair output cell in the real fight median', () => {
  render(<CompareTable />, fullFixtureWithObservedStats())
  const cells = [...host.querySelectorAll('tbody td[data-metric="repairOut"]')]
  const values = cells.flatMap((cell) => {
    const number = cell.querySelector('.app-number:not(summary)')?.textContent
    return number === undefined ? [] : [Number(number.replaceAll(',', ''))]
  }).sort((a, b) => a - b)
  expect(values[0]).toBe(0)
  expect(values.at(-1)).toBeGreaterThan(0)
  const center = (values[Math.floor((values.length - 1) / 2)]! + values[Math.floor(values.length / 2)]!) / 2
  expect(cells[0]?.querySelector('.u7-compare-median')?.getAttribute('title'))
    .toBe(`有数据的 ${values.length} 人的中位 · ${Math.round(center).toLocaleString('en-US')}`)
})

it('shows a reason and omits log provenance for J125990 pilots known only from the BR', () => {
  render(<CompareTable />, fullFixtureWithObservedStats(), 1)
  for (const name of ['zethixx', 'Xafen Katapi', 'Crafty Beaver']) {
    const row = [...host.querySelectorAll('tbody tr')].find((candidate) =>
      candidate.querySelector('th button')?.getAttribute('aria-label') === name)!
    const keys = ['damageOut', 'damageIn', 'repairOut', 'pointSeconds']
    expect.soft(row.querySelector('.u7-observed'), name).toBeNull()
    expect.soft(keys.map((metric) => {
      const missing = row.querySelector(`[data-metric="${metric}"] .u7-no-value summary`)
      return [missing?.firstChild?.textContent?.trim(), missing?.getAttribute('title')]
    }), name).toEqual(keys.map(() => ['—', '没有上传他的战斗日志']))
  }
})

it('reports incoming damage median 20,722 over 120 measured J125990 pilots at the audit cursor', async () => {
  const { module } = await runnerImport<{ realBattleStateWithBr(): BattleState }>(
    resolve('fixtures/real/j125990-20250622/load.ts'), { configFile: false },
  )
  const analysis = analyze(module.realBattleStateWithBr())
  render(<CompareTable />, { summary: fixture.summary, analysis }, 1, 1_750_606_982_420)
  const cells = [...host.querySelectorAll('tbody td[data-metric="damageIn"]')]
  const measured = cells.flatMap((cell) => cell.querySelector('span.app-number')?.textContent ?? [])
  expect.soft(measured).toHaveLength(120)
  expect.soft(measured).toContain('0')
  expect(cells[0]?.querySelector('.u7-compare-median')?.getAttribute('title')).toBe('有数据的 120 人的中位 · 20,722')
})

it('shows observed incoming damage types and explains the unknown type in Compare and the drawer', () => {
  const data = fullFixtureWithObservedStats()
  const key = 'char:2113835664' // J125990: Kylo Kingdom, with no uploaded log.
  expect(data.analysis.entities[key]?.hasLog).toBe(false)
  render(<><CompareTable /><PersonDrawer /></>, data, 1)
  for (const name of ['电磁', '未知类型']) {
    const toggle = [...host.querySelectorAll('.u7-column-options label')].find((label) => label.textContent.trim() === name)!
    act(() => toggle.querySelector('input')!.click())
  }
  const row = host.querySelector(`tr[data-pilot-key="${key}"]`)!
  const amount = (kind: string) => row.querySelector(`td[data-metric="${kind}"] .app-number:not(summary)`)?.textContent
  expect(row.textContent).toContain('据他人日志')
  expect.soft(amount('em')).toBe('34,926')
  expect.soft(amount('unknown')).toBe('34,080')
  act(() => row.querySelector<HTMLButtonElement>('th button')!.click())
  expect(host.querySelector('.u7-person-header')?.textContent).toContain('据他人日志')
  expect.soft(host.querySelector('.u7-person-damage')?.textContent ?? '').toContain('电磁34,926')
  expect.soft(host.querySelector('.u7-person-damage dt[title]')?.getAttribute('title') ?? '').toContain('弹药')
})

it('shows full and selected-range damage from the real fixture', () => {
  function Harness() {
    const { setRange } = useView()
    return <><button id="range" onClick={() => setRange([1750606900000, 1750606960000])}>Range</button><CompareTable /></>
  }
  render(<Harness />)
  const cells = () => [...host.querySelectorAll('tbody tr')].find((row) => row.querySelector('th')?.textContent === 'Blanchard2213')!
    .querySelectorAll('td')
  // J125990, 15:41:40–15:42:40 UTC. Sum of outgoing and incoming damage in that inclusive minute.
  expect(cells()[0]?.textContent).toBe('442,358')
  expect(cells()[5]?.textContent).toBe('226,211')
  act(() => host.querySelector<HTMLButtonElement>('#range')!.click())
  expect(host.querySelector('.u7-compare-note')?.textContent).toContain('选段 15:41:40–15:42:40')
  expect(cells()[0]?.textContent).toBe('41,222')
  expect(cells()[5]?.textContent).toBe('2,093')
})

it('uses a single roving tab stop per populated distribution metric', () => {
  render()
  const distributionTab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((el) => el.textContent === '分布')!
  act(() => distributionTab.click())
  const strips = [...host.querySelectorAll('.u7-distribution-strip')]
  expect(strips.length).toBeGreaterThan(1)
  for (const strip of strips) expect([...strip.querySelectorAll('button')].filter((el) => el.tabIndex === 0)).toHaveLength(1)
  const points = strips[0]!.querySelectorAll<HTMLButtonElement>('button')
  expect(points.length).toBeGreaterThan(1)
  act(() => points[0]!.focus())
  act(() => points[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })))
  expect(document.activeElement).toBe(points[1])
  expect(points[0]!.tabIndex).toBe(-1)
  expect(points[1]!.tabIndex).toBe(0)
})

it('describes an unavailable value to assistive tech and reveals its reason on tap', () => {
  render()
  const missing = host.querySelector('.u7-no-value')!
  expect(missing).not.toBeNull()
  const toggle = missing.querySelector<HTMLElement>('summary')!
  const reason = document.getElementById(toggle?.getAttribute('aria-describedby') ?? '')
  expect(reason?.textContent).toBe('他没修过队友，或被修的人没有可对应的掉血记录')
  expect(reason?.classList.contains('sr-only')).toBe(true)
  const panel = missing.querySelector('.u7-no-value-reason')
  expect(panel?.textContent).toBe(reason?.textContent)
  act(() => toggle.click())
  expect(missing.hasAttribute('open')).toBe(true)
})

it('labels the whole fight from the first interaction to the last killmail', () => {
  render(<CompareTable />, loadUiFixture({ fullPilotEvents: true }))
  expect(host.querySelector('.u7-compare-note')?.textContent).toContain('全场 15:39–16:42')
})

it.each([
  { count: 2, expected: ['我方', '敌方'] },
  { count: 4, expected: ['我方', '敌方', 'C 方', 'D 方'] },
])('uses replay labels in the $count-side filter', ({ count, expected }) => {
  const coverage = [...fixture.analysis.coverage]
  if (count === 4) coverage.push({ side: 2, known: 1, withLog: 0 }, { side: 3, known: 2, withLog: 0 })
  render(<CompareTable />, { ...fixture, analysis: { ...fixture.analysis, coverage } })
  const filter = [...host.querySelectorAll('details')].find((details) =>
    details.querySelector('summary')?.textContent === '阵营')!
  act(() => filter.querySelector('summary')!.click())
  const labels = [...filter.querySelectorAll('label')].map((label) => label.textContent.trim())
  expect(labels).toEqual(expected)
})

it('shares more than four pinned pilots across table and charts and clears them together', () => {
  render()
  const tab = (name: string) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    .find((button) => button.textContent === name)!
  const tableChecks = [...host.querySelectorAll<HTMLInputElement>('tbody input[type="checkbox"]')]
  const checked = () => host.querySelectorAll('tbody input:checked').length
  const chosen = tableChecks.slice(0, 8)
  act(() => chosen.forEach((checkbox) => checkbox.click()))
  expect(checked()).toBe(8)
  expect([...host.querySelectorAll('tbody tr')].slice(0, 8).every((row) => row.getAttribute('data-pinned') === 'true')).toBe(true)

  act(() => tab('并排').click())
  const card = host.querySelector('.u7-compare-cards section')!
  expect(card.querySelectorAll('.u7-compare-pair')).toHaveLength(8)
  const picker = host.querySelector('.u7-compare-pick')!
  expect(picker.querySelectorAll('input:checked')).toHaveLength(8)
  act(() => picker.querySelector<HTMLInputElement>('input:not(:checked)')!.click())
  expect(card.querySelectorAll('.u7-compare-pair')).toHaveLength(9)

  act(() => tab('分布').click())
  expect(host.querySelectorAll('.u7-distribution-strip:first-child [data-highlighted="true"]').length).toBeGreaterThan(4)
  const clear = [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === '清除勾选')!
  act(() => clear.click())
  expect(host.querySelectorAll('[data-highlighted="true"]')).toHaveLength(0)
  act(() => tab('大表').click())
  expect(checked()).toBe(0)
})

it('exposes the full pilot name as a title and accessible button label', () => {
  render()
  const button = [...host.querySelectorAll<HTMLButtonElement>('tbody th button')]
    .find((candidate) => candidate.textContent === 'Oldowner ofdock')!
  expect(button.title).toBe('Oldowner ofdock')
  expect(button.getAttribute('aria-label')).toBe('Oldowner ofdock')
})

it('shows hit rate and a quality distribution for two uploaders and recomputes both in a real range', () => {
  function Harness() {
    const { setRange } = useView()
    return <><button id="hit-range" onClick={() => setRange([1750606900000, 1750606960000])}>Range</button><CompareTable /></>
  }
  render(<Harness />)
  const header = [...host.querySelectorAll('thead th[scope="col"]')].find((el) => el.textContent.trim() === '命中率')!
  expect(header).toBeDefined()
  expect([...host.querySelectorAll('[scope="colgroup"]')].map((el) => el.textContent)).toContain('命中')
  const row = (name: string) => [...host.querySelectorAll('tbody tr')].find((row) => row.querySelector('th')?.textContent === name)!
  const cells = (name: string) => row(name).querySelector('td[data-metric="hitRate"]')!
  const rate = (name: string) => cells(name).querySelector('.app-number')?.textContent
  expect(rate('Blanchard2213')).toBe('92%')
  expect(rate('Lucinda HIly')).toBe('98%')
  const bar = () => row('Blanchard2213').querySelector('td[data-metric="hitQuality"] .u7-hit-quality')!
  expect(bar().getAttribute('title')).toContain('未命中 184')
  const widths = () => [...bar().querySelectorAll<HTMLElement>('[data-quality]')]
    .reduce((sum, segment) => sum + Number.parseFloat(segment.style.width), 0)
  expect(widths()).toBeCloseTo(100)
  expect(cells('Blanchard2213').querySelector('[title^="有数据的 "]')).not.toBeNull()
  act(() => header.querySelector('button')!.click())
  expect(header.getAttribute('aria-sort')).toBe('descending')
  act(() => host.querySelector<HTMLButtonElement>('#hit-range')!.click())
  expect(rate('Blanchard2213')).toBe('97%')
  expect(rate('Lucinda HIly')).toBe('97%')
  expect(bar().getAttribute('title')).toContain('未命中 2')
  expect(widths()).toBeCloseTo(100)
})

it('tags observed pilots 据他人日志 in the compare rows', () => {
  const pilot = fixture.analysis.entities['char:2120391968']! // Kohera has recorded shots in the replay excerpt.
  render(<CompareTable />, {
    ...fixture,
    analysis: { ...fixture.analysis, stats: fixture.analysis.stats.map((s) => s.key === pilot.key ? { ...s, source: 'observed' as const } : s) },
  })
  const rows = [...host.querySelectorAll('tbody tr')].filter((r) => r.textContent?.includes('据他人日志'))
  expect(rows.length).toBe(1)
  expect(rows[0]!.textContent).toContain(pilot.name)
})

it('shows the measured rate and sample for an enemy firing on uploaders in J125990', () => {
  const key = 'char:2120391968' // Kohera Hakomairos, 35 eligible observed shots in the archived excerpt.
  render(<CompareTable />, {
    ...fixture,
    // The archived counters predate the observed source field.
    analysis: { ...fixture.analysis, stats: fixture.analysis.stats.map((s) => s.key === key ? { ...s, source: 'observed' as const } : s) },
  }, 1)
  const row = [...host.querySelectorAll('tbody tr')].find((el) => el.querySelector('th')?.textContent?.includes('Kohera Hakomairos'))
  const hitCell = row?.querySelector('td[data-metric="hitRate"]')
  expect(hitCell?.querySelector('.app-number')?.textContent).toBe('100%')
  expect(hitCell?.textContent).toContain('据他人日志')
  expect(hitCell?.textContent).toContain('35 发')
  expect(row?.querySelector('td[data-metric="hitQuality"] .u7-hit-quality')).not.toBeNull()
})

it('counts identified pilots by default and appends unidentified entities in a separate group on request', () => {
  const unknown = Object.values(fixture.analysis.entities).filter(({ charId }) => charId === null).slice(0, 2)
  // Synthetic stats for archived unidentified rows, which have no stored pilot stats.
  const extra = unknown.map(({ key }) => ({ ...fixture.analysis.stats[0]!, key, damageOut: 0 }))
  const countUnknown = extra.length
  const countPilots = fixture.analysis.stats.length
  expect(countUnknown).toBe(2)
  render(<CompareTable />, { ...fixture, analysis: { ...fixture.analysis, stats: [...fixture.analysis.stats, ...extra] } })
  const rows = () => [...host.querySelectorAll<HTMLTableRowElement>('tbody tr[data-pilot-key]')]
  expect(rows()).toHaveLength(countPilots)
  expect(rows().every((row) => row.dataset.pilotKey?.startsWith('char:'))).toBe(true)
  const toggle = [...host.querySelectorAll('button')].find((button) => button.textContent === `含未识别 ${countUnknown}`)!
  expect(toggle.getAttribute('aria-pressed')).toBe('false')
  act(() => toggle.click())
  const group = host.querySelector('tbody[aria-label="未识别"]')
  expect(group?.querySelectorAll('tr[data-pilot-key]')).toHaveLength(countUnknown)
  expect(group?.parentElement?.lastElementChild).toBe(group)
  expect(host.querySelector('.u7-compare-note')?.textContent).toContain(`${countPilots} 人 · ${countUnknown} 项未识别`)
  act(() => toggle.click())
  expect(rows()).toHaveLength(countPilots)
})

it('labels the hit quality distribution in its own column and follows hit-rate visibility', () => {
  render()
  const quality = () => [...host.querySelectorAll('thead th[scope="col"]')].find((cell) => cell.textContent === '命中质量')
  expect(quality()).toBeDefined()
  const group = [...host.querySelectorAll('thead th[scope="colgroup"]')].find((cell) => cell.textContent === '命中')
  expect(group?.getAttribute('colspan')).toBe('2')
  const row = host.querySelector('tr[data-pilot-key="char:2121605780"]')!
  expect(row.querySelector('td:last-child .u7-hit-quality')).not.toBeNull()
  expect(row.querySelector('td:nth-last-child(2) .app-number')?.textContent).toBe('92%')
  const toggle = [...host.querySelectorAll('.u7-column-options label')].find((label) => label.textContent?.trim() === '命中率')!
    .querySelector('input')!
  act(() => toggle.click())
  expect(quality()).toBeUndefined()
})

it.each([
  ['no uploads', '上传日志后这里会列出每个飞行员的数据'],
  ['side filter', '调整阵营筛选'],
  ['empty range', '扩大或清除选段'],
] as const)('explains how to populate comparison with %s', (cause, guidance) => {
  function Harness() {
    const { setRange } = useView()
    return <><button id="empty-range" onClick={() => {
      const end = fixture.summary.meta.killmails.at(-1)!.t
      setRange([end + 60_000, end + 120_000])
    }}>Range</button><CompareTable /></>
  }
  render(<Harness />, cause === 'no uploads' ? { ...fixture, summary: { ...fixture.summary, logs: [] } } : fixture)
  if (cause === 'side filter') {
    act(() => host.querySelectorAll<HTMLInputElement>('.u7-compare-controls details:first-child input')
      .forEach((input) => input.click()))
  } else if (cause === 'empty range') {
    act(() => host.querySelector<HTMLButtonElement>('#empty-range')!.click())
  }
  expect(host.querySelector('.u7-compare [role="status"]')?.textContent ?? '').toContain(guidance)
  expect(host.querySelector('.u7-compare table')).toBeNull()
  if (cause === 'empty range') {
    act(() => host.querySelector<HTMLButtonElement>('.battle-range-chip')!.click())
    expect(host.querySelector('.u7-compare tbody tr')).not.toBeNull()
  }
})
