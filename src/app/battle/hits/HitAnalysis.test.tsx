// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { BattleProvider } from '../../state/battle-store'
import { useView, ViewProvider } from '../../state/view-store'
import { loadUiFixture, uiReplayStart } from '../../test/ui-fixture'
import { HitAnalysis } from '../HitAnalysis'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

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
    expect(view.querySelector('.hit-card:nth-child(2)')?.textContent).toContain('据我方日志')
    expect(view.querySelector('.hit-trend svg')).not.toBeNull()
    expect(view.querySelector('.hit-insufficient')?.textContent).toContain('少于 30 发')
    const row = () => [...view.querySelectorAll<HTMLTableRowElement>('tbody tr')].find((el) => el.querySelector('th button')?.textContent === 'Blanchard2213')!
    expect(row().cells[0]?.textContent).toMatch(/\d+ · 2,580 发/)
    expect(row().cells[2]?.textContent).toBe('93%')
    act(() => host.querySelector<HTMLButtonElement>('#minute')!.click())
    expect(row().cells[0]?.textContent).toMatch(/\d+ · \d+ 发/)
    expect(row().cells[2]?.textContent).not.toBe('93%')
    const enemyFilter = [...view.querySelectorAll('.hit-analysis-controls details label')].find((label) => label.textContent?.trim() === '敌方')!
    act(() => enemyFilter.querySelector<HTMLInputElement>('input')!.click())
    expect([...view.querySelectorAll('.hit-card h3')].map((heading) => heading.textContent?.trim()))
      .not.toContain('敌方 据我方日志')
    expect([...view.querySelectorAll('tbody th small')].some((label) => label.textContent?.includes('敌方'))).toBe(false)
  } finally {
    act(() => root.unmount())
    host.remove()
  }
})
