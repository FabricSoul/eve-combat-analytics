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
