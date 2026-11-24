// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { BattleUndo, useBattleUndo } from './undo'

it('reverts the latest edit once and expires the action after six seconds', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  const host = document.createElement('div')
  const root = createRoot(host)
  let show!: ReturnType<typeof useBattleUndo>
  const undo = vi.fn(async () => {})
  function Probe() { show = useBattleUndo(); return null }
  try {
    await act(() => root.render(<BattleUndo><Probe /></BattleUndo>))
    await act(() => show('已改为敌方', undo))
    expect(host.textContent).toContain('已改为敌方')
    await act(async () => host.querySelector('button')!.click())
    expect(undo).toHaveBeenCalledTimes(1)
    expect(host.textContent).toContain('已撤销')
    await act(() => show('已合并身份', undo))
    await act(() => vi.advanceTimersByTime(5999))
    expect(host.querySelector('button')?.textContent).toBe('撤销')
    await act(() => vi.advanceTimersByTime(1))
    expect(host.querySelector('button')).toBeNull()
  } finally {
    await act(() => root.unmount())
    vi.useRealTimers()
    vi.unstubAllGlobals()
  }
})
