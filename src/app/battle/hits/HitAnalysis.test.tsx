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
    expect(row().cells[0]?.textContent).toMatch(/\d+ · 1,854 发/)
    expect(row().cells[2]?.textContent).toBe('90%')
    expect(row().textContent).toContain('无命中质量 726 发')
    act(() => host.querySelector<HTMLButtonElement>('#minute')!.click())
    expect(row().cells[0]?.textContent).toMatch(/\d+ · \d+ 发/)
    expect(row().cells[2]?.textContent).not.toBe('90%')
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
