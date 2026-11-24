// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { BattleProvider } from '../../state/battle-store'
import { useView, ViewProvider } from '../../state/view-store'
import { loadUiFixture } from '../../test/ui-fixture'
import { CompareTable } from '../CompareTable'

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

function render(children = <CompareTable />, data = fixture) {
  act(() => root.render(
    <BattleProvider static={data}><ViewProvider syncUrl={false}>{children}</ViewProvider></BattleProvider>,
  ))
}

it('groups and sorts columns and shows a median', () => {
  render()
  for (const label of ['输出', '节奏', '承伤', '后勤', '点控']) {
    expect([...host.querySelectorAll('[scope="colgroup"]')].map((el) => el.textContent)).toContain(label)
  }
  const header = host.querySelector('[aria-sort="descending"]')!
  expect(header.textContent).toContain('输出')
  expect(host.querySelector('[title^="全队中位"]')).not.toBeNull()
  const first = host.querySelector('tbody tr')!.textContent
  act(() => header.querySelector('button')!.click())
  expect(header.getAttribute('aria-sort')).toBe('ascending')
  expect(host.querySelector('tbody tr')!.textContent).not.toBe(first)
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
  const cells = (name: string) => [...host.querySelectorAll('tbody tr')].find((row) => row.querySelector('th')?.textContent === name)!
    .querySelector('td:last-child')!
  const rate = (name: string) => cells(name).querySelector('.app-number')?.textContent
  expect(rate('Blanchard2213')).toBe('92%')
  expect(rate('Lucinda HIly')).toBe('98%')
  const bar = () => cells('Blanchard2213').querySelector('.u7-hit-quality')!
  expect(bar().getAttribute('title')).toContain('未命中 184')
  const widths = () => [...bar().querySelectorAll<HTMLElement>('[data-quality]')]
    .reduce((sum, segment) => sum + Number.parseFloat(segment.style.width), 0)
  expect(widths()).toBeCloseTo(100)
  expect(cells('Blanchard2213').querySelector('[title^="全队中位"]')).not.toBeNull()
  act(() => header.querySelector('button')!.click())
  expect(header.getAttribute('aria-sort')).toBe('descending')
  act(() => host.querySelector<HTMLButtonElement>('#hit-range')!.click())
  expect(rate('Blanchard2213')).toBe('97%')
  expect(rate('Lucinda HIly')).toBe('97%')
  expect(bar().getAttribute('title')).toContain('未命中 2')
  expect(widths()).toBeCloseTo(100)
})

it('tags observed pilots 据我方日志 in the compare rows', () => {
  const pilot = Object.values(fixture.analysis.entities).find((e) => e.charId !== null && !e.hasLog)!
  render(<CompareTable />, {
    ...fixture,
    analysis: { ...fixture.analysis, stats: fixture.analysis.stats.map((s) => s.key === pilot.key ? { ...s, source: 'observed' as const } : s) },
  })
  const rows = [...host.querySelectorAll('tbody tr')].filter((r) => r.textContent?.includes('据我方日志'))
  expect(rows.length).toBe(1)
  expect(rows[0]!.textContent).toContain(pilot.name)
})
