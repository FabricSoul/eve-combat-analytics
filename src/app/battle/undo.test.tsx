// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { BattleSummary } from '@/core/contract'
import { loadUiFixture } from '../test/ui-fixture'
import { BattleUndo, useBattleUndo } from './undo'

function mountUndo(portal?: HTMLElement) {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  let start!: ReturnType<typeof useBattleUndo>
  function Probe() { start = useBattleUndo(); return null }
  const container = portal ?? host
  return {
    host,
    render: (analyzedSummary?: BattleSummary) => act(() => root.render(
      <BattleUndo analyzedSummary={analyzedSummary} host={portal}><Probe /></BattleUndo>,
    )),
    begin: (...args: Parameters<typeof start>) => start(...args),
    toasts: () => [...container.querySelectorAll<HTMLElement>('[data-battle-toast]')],
    unmount: async () => { await act(() => root.unmount()); host.remove() },
  }
}

const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms))

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('counts the undo window from the action while pending analysis keeps its status', async () => {
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
  }
})

it('shows an optimistic undo immediately and pauses independently for hover and focus', async () => {
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
  }
})

it('keeps each undo button reachable inside the native phone drawer', async () => {
  const drawer = document.createElement('dialog')
  document.body.appendChild(drawer)
  drawer.open = true
  const app = mountUndo(drawer)
  try {
    await app.render()
    await act(() => {
      app.begin({ label: '已合并身份', revert: async () => {} })
      app.begin({ label: '已保存配装', revert: async () => {} })
    })
    const buttons = [...drawer.querySelectorAll<HTMLButtonElement>('[data-battle-toast] button')]
    expect(buttons.map(({ textContent }) => textContent)).toEqual(['撤销', '撤销'])
    expect(app.host.querySelector('[data-battle-toast]')).toBeNull()
    for (const button of buttons) {
      await act(() => button.focus())
      expect(document.activeElement).toBe(button)
    }
  } finally {
    await app.unmount()
    drawer.remove()
  }
})

it('keeps both edits independently undoable when their requests finish out of order', async () => {
  const app = mountUndo()
  const undoFirst = vi.fn(async () => {})
  const undoSecond = vi.fn(async () => {})
  try {
    await app.render()
    let finishFirst!: ReturnType<typeof app.begin>
    await act(() => { finishFirst = app.begin() })
    await tick(3000)
    await act(() => app.begin()({ label: '已保存配装', revert: undoSecond }))
    expect(app.toasts().map((toast) => toast.querySelector('[role=status]')?.textContent)).toEqual(['正在应用…', '已保存配装'])
    await act(() => finishFirst({ label: '已改为所选阵营', revert: undoFirst }))
    const [first, second] = app.toasts()
    expect(first?.textContent).toContain('已改为所选阵营')
    expect(second?.textContent).toContain('已保存配装')
    await act(async () => second!.querySelector('button')!.click())
    expect(undoSecond).toHaveBeenCalledTimes(1)
    expect(undoFirst).not.toHaveBeenCalled()
    await act(async () => first!.querySelector('button')!.click())
    expect(undoFirst).toHaveBeenCalledTimes(1)
  } finally {
    await app.unmount()
  }
})

it('expires edits made three seconds apart at 10 and 13 seconds respectively', async () => {
  const app = mountUndo()
  try {
    await app.render()
    await act(() => app.begin({ label: '已合并身份', revert: async () => {} }))
    await tick(3000)
    await act(() => app.begin({ label: '已保存配装', revert: async () => {} }))
    expect(app.toasts().map((toast) => toast.querySelector('[role=timer]')?.getAttribute('aria-label')))
      .toEqual(['撤销剩余时间 7 秒', '撤销剩余时间 10 秒'])
    await tick(6999)
    expect(app.toasts().filter((toast) => toast.querySelector('button'))).toHaveLength(2)
    await tick(1)
    expect(app.toasts()).toHaveLength(1)
    expect(app.toasts()[0]?.textContent).toContain('已保存配装')
    await tick(2999)
    expect(app.toasts()[0]?.querySelector('button')).not.toBeNull()
    await tick(1)
    expect(app.toasts()).toHaveLength(0)
  } finally {
    await app.unmount()
  }
})

it('pauses only the hovered or focused edit', async () => {
  const app = mountUndo()
  try {
    await app.render()
    await act(() => app.begin({ label: '已合并身份', revert: async () => {} }))
    await tick(3000)
    await act(() => app.begin({ label: '已保存配装', revert: async () => {} }))
    const [first, second] = app.toasts()
    expect(first?.textContent).toContain('已合并身份')
    const button = first!.querySelector('button')!
    await act(() => first!.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    await tick(10_000)
    expect(second?.isConnected).toBe(false)
    expect(button.isConnected).toBe(true)
    await act(() => button.focus())
    await act(() => first!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
    await act(() => app.begin({ label: '已改为所选阵营', revert: async () => {} }))
    await tick(10_000)
    expect(app.toasts()).toEqual([first])
    await act(() => button.blur())
    await tick(6999)
    expect(button.isConnected).toBe(true)
    await tick(1)
    expect(button.isConnected).toBe(false)
  } finally {
    await app.unmount()
  }
})

it('shows why the oldest window closed when a fourth edit arrives', async () => {
  const app = mountUndo()
  const oldestUndo = vi.fn(async () => {})
  try {
    await app.render()
    let finishOldest!: ReturnType<typeof app.begin>
    await act(() => { finishOldest = app.begin() })
    const labels = ['已保存配装', '已合并身份', '已恢复报告阵营']
    await act(() => {
      for (const label of labels) app.begin({ label, revert: async () => {} })
    })
    expect(app.toasts().map((toast) => toast.querySelector('[role=status]')?.textContent)).toEqual(labels)
    expect(app.host.textContent).toContain('最早一项改动的撤销时间已结束')
    await act(() => finishOldest({ label: '已改为所选阵营', revert: oldestUndo }))
    expect(app.toasts().filter((toast) => toast.querySelector('button'))).toHaveLength(3)
    expect(app.host.textContent).not.toContain('已改为所选阵营')
    expect(oldestUndo).not.toHaveBeenCalled()
  } finally {
    await app.unmount()
  }
})
