// @vitest-environment jsdom
import { act, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it } from 'vitest'
import { BattleProvider } from '../../state/battle-store'
import { useView, ViewProvider } from '../../state/view-store'
import { loadUiFixture } from '../../test/ui-fixture'
import { PersonDrawer } from '../PersonDrawer'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

it('opens a selected pilot, toggles replay focus, expands, and closes on Escape', () => {
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
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })) })
    expect(host.querySelector('h2')).toBeNull()
  } finally {
    act(() => root.unmount())
  }
})
