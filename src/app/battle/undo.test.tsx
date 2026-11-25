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
    toasts: () => [...container.querySelectorAll<HTMLElement>('[data-battle-toast]')]
      .filter((toast) => !toast.closest('[hidden]')),
    overflow: () => [...container.querySelectorAll('button')].find((button) =>
      /^还有 \d+ 项可撤销$/.test(button.textContent)),
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

const overlappingEdits = ['已改为所选阵营', '已保存配装', '已合并身份', '已恢复报告阵营', '已保存新配装']

it('reveals two older edits on click and undoes all five edits independently', async () => {
  const app = mountUndo()
  const reverted: string[] = []
  try {
    await app.render()
    const firstLabel = overlappingEdits[0]!
    const edit = (label: string) => ({
      label, revert: async () => { reverted.push(label) },
    })
    let finishOldest!: ReturnType<typeof app.begin>
    await act(() => { finishOldest = app.begin() })
    for (const label of overlappingEdits.slice(1)) {
      await tick(900)
      await act(() => app.begin(edit(label)))
    }
    await act(() => finishOldest(edit(firstLabel)))

    const labels = () => app.toasts().map((toast) => toast.querySelector('[role=status]')?.textContent)
    expect(labels()).toEqual(overlappingEdits.slice(2))
    expect(app.host.textContent).not.toContain('撤销时间已结束')
    expect(app.overflow()?.textContent).toBe('还有 2 项可撤销')
    expect(app.overflow()?.getAttribute('aria-expanded')).toBe('false')
    await act(() => app.overflow()?.click())
    expect(app.overflow()?.getAttribute('aria-expanded')).toBe('true')
    expect(labels()).toEqual(overlappingEdits)
    expect(app.toasts().map((toast) => toast.querySelector('[role=timer]')?.getAttribute('aria-label')))
      .toEqual([7, 8, 9, 10, 10].map((seconds) => `撤销剩余时间 ${seconds} 秒`))

    for (const label of overlappingEdits) {
      const button = app.toasts().find((toast) => toast.textContent === `${label}撤销`)?.querySelector('button')
      expect(button?.textContent).toBe('撤销')
      await act(async () => button?.click())
    }
    expect(reverted).toEqual(overlappingEdits)
  } finally {
    await app.unmount()
  }
})

it('keeps overflow expanded when the first pointer click also focuses its row', async () => {
  const app = mountUndo()
  try {
    await app.render()
    await act(() => {
      for (const label of overlappingEdits) app.begin({ label, revert: async () => {} })
    })
    const button = app.overflow()!
    const press = () => button.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    const release = () => button.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
    await act(() => { press() })
    await act(() => button.focus())
    expect(button.getAttribute('aria-expanded')).toBe('true')
    await act(() => { release() })
    expect(button.getAttribute('aria-expanded')).toBe('true')
    await act(() => { press(); release() })
    expect(button.getAttribute('aria-expanded')).toBe('false')
  } finally {
    await app.unmount()
  }
})

it('expires five overlapping windows at their own deadlines, including while collapsed', async () => {
  const app = mountUndo()
  try {
    await app.render()
    for (const label of overlappingEdits) {
      if (label !== overlappingEdits[0]) await tick(900)
      await act(() => app.begin({ label, revert: async () => {} }))
    }

    await tick(6399)
    expect(app.overflow()?.textContent).toBe('还有 2 项可撤销')
    await tick(1)
    expect(app.overflow()?.textContent).toBe('还有 1 项可撤销')
    expect(app.overflow()?.getAttribute('aria-expanded')).toBe('false')
    await act(() => app.overflow()?.focus())
    expect(app.overflow()?.getAttribute('aria-expanded')).toBe('true')

    for (const label of overlappingEdits.slice(1)) {
      await tick(899)
      expect(app.toasts()[0]?.textContent).toContain(label)
      expect(app.toasts()[0]?.querySelector('button')?.textContent).toBe('撤销')
      await tick(1)
      expect(app.toasts().some((toast) => toast.textContent?.includes(label))).toBe(false)
    }
    expect(app.toasts()).toHaveLength(0)
  } finally {
    await app.unmount()
  }
})
