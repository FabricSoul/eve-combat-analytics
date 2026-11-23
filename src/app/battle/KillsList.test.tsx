// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import { BattleProvider } from '../state/battle-store'
import { useView, ViewProvider } from '../state/view-store'
import { loadUiFixture } from '../test/ui-fixture'
import { KillsList } from './KillsList'

const podTypes = new Set([670, 33328])
let root: Root | undefined
let host: HTMLElement

beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true })
afterEach(() => { act(() => root?.unmount()); host?.remove() })

function Probe() {
  const view = useView()
  return <output data-t={view.t} data-sel={view.selected ?? ''} />
}

function mount(fixture = loadUiFixture()) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(
    <BattleProvider static={fixture}>
      <ViewProvider syncUrl={false} initialTime={0}><KillsList /><Probe /></ViewProvider>
    </BattleProvider>,
  ))
  return fixture
}

describe('KillsList', () => {
  it('lists every killmail except pods, in time order', () => {
    const { summary } = mount()
    const shown = summary.meta.killmails.filter(({ victim }) => !podTypes.has(victim.shipTypeId ?? -1))
    expect(shown.length).toBeLessThan(summary.meta.killmails.length)
    const rows = host.querySelectorAll('button.kills-row')
    expect(rows).toHaveLength(shown.length)
    expect(host.textContent).toContain(`${shown.length} 艘`)
    const first = shown[0]!
    expect(rows[0]!.textContent).toContain(summary.meta.names[first.victim.charId!]!.name)
    expect(rows[0]!.textContent).toContain(summary.meta.names[first.victim.shipTypeId!]!.name)
  })

  it('seeks to the kill and selects the victim on click', () => {
    const { summary } = mount()
    const shown = summary.meta.killmails.filter(({ victim }) => !podTypes.has(victim.shipTypeId ?? -1))
    const target = shown[3]!
    act(() => host.querySelectorAll<HTMLButtonElement>('button.kills-row')[3]!.click())
    const probe = host.querySelector('output')!
    expect(Number(probe.dataset.t)).toBe(target.t)
    expect(probe.dataset.sel).toBe(`char:${target.victim.charId}`)
    expect(host.querySelectorAll('button.kills-row')[3]!.getAttribute('aria-current')).toBe('true')
  })

  it('keeps the victim selected when the same row is clicked again', () => {
    mount()
    const row = () => host.querySelectorAll<HTMLButtonElement>('button.kills-row')[0]!
    act(() => row().click())
    act(() => row().click())
    expect(host.querySelector('output')!.dataset.sel).toMatch(/^char:/)
  })
})
