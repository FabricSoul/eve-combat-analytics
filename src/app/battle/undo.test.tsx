// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import type { BattleSummary } from '@/core/contract'
import { loadUiFixture } from '../test/ui-fixture'
import { BattleUndo, useBattleUndo } from './undo'

it('waits for the applied analysis on edit and undo, then offers undo for nine seconds', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  const host = document.createElement('div')
  const root = createRoot(host)
  let begin!: ReturnType<typeof useBattleUndo>
  const { summary } = loadUiFixture()
  const changed = { ...summary, analysisVersion: summary.analysisVersion + 1 }
  const restored = { ...summary, analysisVersion: summary.analysisVersion + 2 }
  const undo = vi.fn(async () => (state: BattleSummary) => state === restored)
  function Probe() { begin = useBattleUndo(); return null }
  const render = (analyzedSummary: BattleSummary) => act(() => root.render(
    <BattleUndo analyzedSummary={analyzedSummary}><Probe /></BattleUndo>,
  ))
  const button = () => host.querySelector('button')
  try {
    await render(summary)
    let complete!: ReturnType<typeof begin>
    await act(() => { complete = begin() })
    expect(host.textContent).toContain('正在应用…')
    await act(() => complete({ label: '已合并身份', revert: undo, visible: (state: BattleSummary) => state === changed }))
    await act(() => vi.advanceTimersByTime(20_000))
    expect(host.textContent).toContain('正在应用…')
    expect(button()).toBeNull()

    await render(changed)
    expect(host.textContent).toContain('已合并身份')
    await act(() => vi.advanceTimersByTime(8999))
    expect(button()?.textContent).toBe('撤销')
    await act(async () => button()!.click())
    expect(undo).toHaveBeenCalledTimes(1)
    await act(() => vi.advanceTimersByTime(20_000))
    expect(host.textContent).toContain('正在应用…')
    await render(restored)
    expect(host.textContent).toContain('已撤销')

    await act(() => begin()({ label: '已保存配装', revert: undo }))
    await act(() => vi.advanceTimersByTime(8999))
    expect(button()?.textContent).toBe('撤销')
    await act(() => vi.advanceTimersByTime(1))
    expect(button()).toBeNull()
  } finally {
    await act(() => root.unmount())
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
