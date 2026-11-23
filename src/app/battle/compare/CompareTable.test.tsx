// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { statsForRange } from '@/core/analysis/range'
import { BattleProvider } from '../../state/battle-store'
import { useView, ViewProvider } from '../../state/view-store'
import { loadUiFixture } from '../../test/ui-fixture'
import { CompareTable } from '../CompareTable'

vi.mock('@/core/analysis/range', { spy: true })
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const fixture = loadUiFixture()
const host = document.createElement('div')
const root = createRoot(host)

afterEach(() => act(() => root.unmount()))

it('groups and sorts columns, shows a median, and recomputes logged stats for a range', () => {
  function Harness() {
    const { setRange } = useView()
    return <><button id="range" onClick={() => setRange([1000, 2000])}>Range</button><CompareTable /></>
  }
  act(() => root.render(
    <BattleProvider static={fixture}><ViewProvider syncUrl={false}><Harness /></ViewProvider></BattleProvider>,
  ))
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
  act(() => host.querySelector<HTMLButtonElement>('#range')!.click())
  expect(statsForRange).toHaveBeenCalledWith(fixture.analysis, fixture.summary.meta.killmails, 1000, 2000)
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
