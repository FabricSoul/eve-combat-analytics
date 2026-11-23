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
