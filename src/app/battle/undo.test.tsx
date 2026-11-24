// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { BattleSummary } from '@/core/contract'
import { loadUiFixture } from '../test/ui-fixture'
import { BattleUndo, useBattleUndo } from './undo'

it('counts the undo window from the action while pending analysis keeps its status', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  const host = document.createElement('div')
  const root = createRoot(host)
  let begin!: ReturnType<typeof useBattleUndo>
  const { summary } = loadUiFixture()
  const changed = { ...summary, analysisVersion: summary.analysisVersion + 1 }
  const undo = vi.fn(async () => {})
  function Probe() { begin = useBattleUndo(); return null }
  const render = (analyzedSummary: BattleSummary) => act(() => root.render(
    <BattleUndo analyzedSummary={analyzedSummary}><Probe /></BattleUndo>,
  ))
  try {
    await render(summary)
    let complete!: ReturnType<typeof begin>
    await act(() => { complete = begin() })
    expect(host.textContent).toContain('正在应用…')
    await act(() => vi.advanceTimersByTime(4000))
    await act(() => complete({ label: '已保存配装', revert: undo, visible: (state: BattleSummary) => state === changed }))
    expect(host.querySelector('button')).toBeNull()
    await render(changed)
    await act(() => vi.advanceTimersByTime(5999))
    expect(host.querySelector('button')?.textContent).toBe('撤销')
    await act(() => vi.advanceTimersByTime(1))
    expect(host.querySelector('button')).toBeNull()

    await render(summary)
    await act(() => begin()({ label: '已保存配装', revert: undo, visible: (state: BattleSummary) => state === changed }))
    await act(() => vi.advanceTimersByTime(10_001))
    expect(host.textContent).toContain('正在应用…')
    await render(changed)
    expect(host.textContent).toContain('已保存配装')
    expect(host.querySelector('button')).toBeNull()
  } finally {
    await act(() => root.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

it('shows an optimistic undo immediately and pauses independently for hover and focus', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  let begin!: ReturnType<typeof useBattleUndo>
  const undo = vi.fn(async () => {})
  function Probe() { begin = useBattleUndo(); return null }
  try {
    await act(() => root.render(<BattleUndo><Probe /></BattleUndo>))
    await act(() => begin({ label: '已将 A 合并到 B', revert: undo }))
    expect(host.textContent).toContain('已将 A 合并到 B')
    const notice = host.querySelector('[data-battle-toast]')!
    const button = host.querySelector('button')!
    expect(button?.textContent).toBe('撤销')
    await act(() => vi.advanceTimersByTime(7000))
    await act(() => notice.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await act(() => vi.advanceTimersByTime(20_000))
    expect(button.isConnected).toBe(true)
    await act(() => button.focus())
    await act(() => notice.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
    await act(() => vi.advanceTimersByTime(20_000))
    expect(button.isConnected).toBe(true)
    await act(() => button.blur())
    await act(() => vi.advanceTimersByTime(2999))
    expect(button.isConnected).toBe(true)
    await act(() => vi.advanceTimersByTime(1))
    expect(button.isConnected).toBe(false)

    await act(() => begin({ label: '已将 A 合并到 B', revert: undo }))
    await act(async () => host.querySelector('button')!.click())
    expect(undo).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('已撤销')
  } finally {
    await act(() => root.unmount())
    host.remove()
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})

it('keeps undo reachable inside the native phone drawer', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div')
  const drawer = document.createElement('dialog')
  document.body.appendChild(drawer)
  const root = createRoot(container)
  let begin!: ReturnType<typeof useBattleUndo>
  function Probe() { begin = useBattleUndo(); return null }
  try {
    await act(() => root.render(<BattleUndo host={drawer}><Probe /></BattleUndo>))
    await act(() => begin()({ label: '已保存配装', revert: async () => {} }))
    expect(drawer.querySelector('[data-battle-toast] button')?.textContent).toBe('撤销')
    expect(container.querySelector('[data-battle-toast]')).toBeNull()
  } finally {
    await act(() => root.unmount())
    drawer.remove()
    vi.unstubAllGlobals()
  }
})
