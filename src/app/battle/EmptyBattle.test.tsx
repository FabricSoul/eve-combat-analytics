// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { BattleProvider } from '../state/battle-store'
import { ViewProvider } from '../state/view-store'
import { loadUiFixture } from '../test/ui-fixture'
import { EmptyBattle } from './EmptyBattle'

let root: Root | undefined
let host: HTMLElement
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true })
afterEach(() => { act(() => root?.unmount()); host?.remove() })

function mount(onUpload?: () => void) {
  const fixture = loadUiFixture()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(
    <BattleProvider static={{ ...fixture, summary: { ...fixture.summary, logs: [] } }}>
      <ViewProvider syncUrl={false}><EmptyBattle onUpload={onUpload} /></ViewProvider>
    </BattleProvider>,
  ))
}

describe('EmptyBattle', () => {
  it('explains where Gamelogs live and which files to pick', () => {
    mount()
    const text = host.textContent ?? ''
    expect(text).toContain('还没有人上传日志')
    expect(text).toContain('EVE\\logs\\Gamelogs')
    expect(text).toContain('EVE/logs/Gamelogs')
    expect(text).toContain('J125990')
    expect(text).toContain('2025-06-22')
  })

  it('opens the file picker from the drop target', () => {
    const onUpload = vi.fn()
    mount(onUpload)
    act(() => host.querySelector<HTMLButtonElement>('button.empty-pick')!.click())
    expect(onUpload).toHaveBeenCalledOnce()
  })

  it('shows the ISK total with a single unit (R2a-15)', () => {
    const fixture = loadUiFixture()
    const km = fixture.summary.meta.killmails.slice(0, 1).map((k) => ({ ...k, value: 5000 }))
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
    act(() => root!.render(
      <BattleProvider static={{ ...fixture, summary: { ...fixture.summary, logs: [], meta: { ...fixture.summary.meta, killmails: km } } }}>
        <ViewProvider syncUrl={false}><EmptyBattle /></ViewProvider>
      </BattleProvider>,
    ))
    expect(host.textContent).toContain('5,000 ISK')
    expect(host.textContent).not.toContain('ISK ISK')
  })

  it('announces a clipboard failure and offers the link to copy by hand (R2a-15)', async () => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: vi.fn(async () => { throw new Error('denied') }) }, configurable: true })
    mount()
    await act(async () => host.querySelector<HTMLButtonElement>('button.empty-copy')!.click())
    expect(host.querySelector('[role="alert"]')!.textContent).toContain('复制失败')
    const link = host.querySelector<HTMLInputElement>('input.empty-link')!
    expect(link.readOnly).toBe(true)
    expect(link.value).toBe(window.location.href)
  })

  it('copies the invite link', async () => {
    const writeText = vi.fn(async () => undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    mount()
    await act(async () => host.querySelector<HTMLButtonElement>('button.empty-copy')!.click())
    expect(writeText).toHaveBeenCalledWith(window.location.href)
    expect(host.querySelector('button.empty-copy')!.textContent).toContain('已复制')
    expect(host.querySelector('[role="status"]')!.textContent).toContain('已复制')
  })
})
