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

it('colors counterparty bars by viewing side and keeps aggregate incoming damage neutral', () => {
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
    expect(bar('zethx')).toBe('var(--color-side-1)')
    expect(bar('Blanchard2213')).toBe('var(--color-side-0)')
    act(() => host.querySelector<HTMLButtonElement>('.flip')!.click())
    expect(bar('zethx')).toBe('var(--color-side-0)')
    expect(bar('Blanchard2213')).toBe('var(--color-side-1)')
    expect(host.querySelectorAll('.u7-series polyline')[1]?.getAttribute('stroke')).toBe('var(--color-side-n)')
  } finally {
    act(() => root.unmount())
  }
})
