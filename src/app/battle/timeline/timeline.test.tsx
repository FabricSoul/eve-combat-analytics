// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BattleProvider } from '@/app/state/battle-store'
import { ViewProvider, usePlayback, useView } from '@/app/state/view-store'
import { fmtHms, fmtNum } from '@/app/lib/format'
import { loadUiFixture } from '@/app/test/ui-fixture'
import { CompareTable } from '../CompareTable'
import { EventFeed } from '../EventFeed'
import { HitAnalysis } from '../HitAnalysis'
import { Roster } from '../Roster'
import { Timeline } from '../Timeline'
import { Plot } from './Plot'

const fixture = loadUiFixture()
const start = fixture.analysis.timeline.start
const end = Math.max(...fixture.summary.meta.killmails.map(({ t }) => t))
const bounds = { x: 0, left: 0, width: 1000, top: 0, y: 0, right: 1000, bottom: 124, height: 124, toJSON() {} }

let host: HTMLDivElement
let root: Root
let view: ReturnType<typeof useView> & ReturnType<typeof usePlayback>
let restore: ReturnType<typeof vi.spyOn>

function Probe() {
  const current = useView()
  const playback = usePlayback()
  useEffect(() => { view = { ...current, ...playback } }, [current, playback])
  return null
}

async function render(compact = false, data = fixture, other?: ReactNode) {
  await act(() => root.render(
    <BattleProvider static={data}>
      <ViewProvider initialTime={start} endTime={end} defaultSide={1} syncUrl={false}>
        <Timeline compact={compact} />
        {other}
        <Probe />
      </ViewProvider>
    </BattleProvider>,
  ))
}

const chart = () => host.querySelector<SVGSVGElement>('svg[data-timeline-chart]')!
const height = () => Number(chart().getAttribute('height'))
const lanes = () => [...chart().querySelectorAll('[data-lane]')].map((lane) => lane.getAttribute('data-lane'))
const button = (label: string) => [...host.querySelectorAll('button'), ...document.querySelectorAll<HTMLButtonElement>('.side-menu [role="menuitem"]')]
  .find((item) => (item.getAttribute('aria-label') ?? item.textContent?.trim()) === label)!
const click = (label: string) => act(() => button(label).click())
function xAt(t: number) {
  const from = Number(chart().dataset.domainStart)
  const to = Number(chart().dataset.domainEnd)
  return 72 + (bounds.width - 72 - 12) * (t - from) / (to - from)
}
function pointer(type: string, clientX: number, shiftKey = false, pointerId = 1, pointerType = 'mouse', altKey = false) {
  return act(() => chart().dispatchEvent(new PointerEvent(type, {
    bubbles: true, clientX, pointerId, shiftKey, pointerType, altKey,
  })))
}

beforeEach(() => {
  localStorage.clear()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  restore = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(bounds)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  restore.mockRestore()
  vi.unstubAllGlobals()
})

describe('timeline', () => {
  it('offers a touch range editor from an unselected timeline and omits the Shift hint', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({
      matches: query === '(pointer: coarse)', addEventListener: vi.fn(), removeEventListener: vi.fn(),
    }))
    await render()
    expect(host.textContent).not.toContain('Shift+拖动可以只看一段')
    await click('选段')
    const form = host.querySelector<HTMLFormElement>('form[aria-label="编辑选段"]')!
    const fields = [...form.querySelectorAll<HTMLInputElement>('input')]
    expect(fields.map((field) => field.value)).toEqual([fmtHms(start), fmtHms(start + 60_000)])
    fields[0]!.value = fmtHms(start + 15_000)
    fields[1]!.value = fmtHms(start + 45_000)
    await act(() => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(view.range).toEqual([start + 15_000, start + 45_000])
    expect(view.t).toBe(start + 15_000)
    expect(chart().querySelector('[stroke-dasharray="3 3"]')).not.toBeNull()
    await click(`取消选段 ${fmtHms(start + 15_000)}–${fmtHms(start + 45_000)}`)
    expect(view.range).toBeNull()
    expect(button('选段')).toBeDefined()
    await click('时间轴用法')
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain('点「选段」输入开始和结束时间')
  })

  it('offers the range editor rather than the keyboard hint in compact mode', async () => {
    await render(true)
    expect(button('选段')).toBeDefined()
    expect(host.textContent).not.toContain('Shift+拖动可以只看一段')
  })

  it('snaps Shift-drag to one second, snaps long drags to ten seconds, and bypasses snapping with Alt', async () => {
    await render()
    const drag = async (from: number, to: number, alt = false) => {
      await pointer('pointerdown', xAt(from), true, 1, 'mouse', alt)
      await pointer('pointermove', xAt(to), true, 1, 'mouse', alt)
      const actual = host.querySelector('.battle-range-draft')?.textContent
      await pointer('pointerup', xAt(to), true, 1, 'mouse', alt)
      return actual
    }
    await drag(start + 41_400, start + 58_800)
    expect(view.range).toEqual([start + 41_000, start + 59_000])
    expect(await drag(start + 102_800, start + 41_400)).toBe(
      `选段 ${fmtHms(start + 40_000)}–${fmtHms(start + 100_000)}`)
    expect(view.range).toEqual([start + 40_000, start + 100_000])
    await drag(start + 41_400, start + 102_800, true)
    expect(view.range).toEqual([start + 41_400, start + 102_800])
    await drag(start - 4_000, start + 17_400)
    expect(view.range).toEqual([start, start + 17_000])
  })

  it('edits range times, validates format and fight boundaries, and cancels with Escape', async () => {
    await render()
    const original = [start + 40_000, start + 100_000] as const
    await act(() => view.setRange(original))
    const edit = () => host.querySelector<HTMLButtonElement>('button[title="编辑选段"]')!
    expect(edit()).not.toBeNull()
    await act(() => edit().click())
    const dialog = () => host.querySelector<HTMLFormElement>('form[aria-label="编辑选段"]')!
    const inputs = () => [...dialog().querySelectorAll<HTMLInputElement>('input')]
    const apply = () => act(() => dialog().dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })))
    expect(inputs().map((input) => input.value)).toEqual(original.map(fmtHms))
    expect(document.activeElement).toBe(inputs()[0])
    inputs()[0]!.value = '8:00'
    await apply()
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('HH:MM:SS')
    inputs()[0]!.value = fmtHms(start - 1_000)
    await apply()
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('战斗范围')
    inputs()[0]!.value = fmtHms(start + 110_000)
    await apply()
    expect(dialog().querySelector('[role="alert"]')?.textContent).toContain('晚于')
    expect(view.range).toEqual(original)
    await act(() => inputs()[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(edit())
    expect(view.range).toEqual(original)
    await act(() => edit().click())
    const clear = host.querySelector<HTMLButtonElement>('.eca-timeline-controls button[title="取消选段"]')!
    await act(() => clear.focus())
    await act(() => clear.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })))
    expect(dialog()).toBeNull()
    expect(view.range).toEqual(original)
    await act(() => edit().click())
    inputs()[0]!.value = fmtHms(start + 61_000)
    inputs()[1]!.value = fmtHms(start + 139_000)
    await apply()
    expect(view.range).toEqual([start + 61_000, start + 139_000])
    expect(view.t).toBe(start + 61_000)
    expect(dialog()).toBeNull()
    expect(document.activeElement).toBe(edit())
  })

  it('shows the current draft times, commits at the range start, and clears from the range chip', async () => {
    await render()
    const from = start + 40_000
    const to = start + 100_000
    const label = `选段 ${fmtHms(from)}–${fmtHms(to)}`
    await pointer('pointerdown', xAt(to), true)
    await pointer('pointermove', xAt(from), true)
    expect(host.querySelector('.eca-timeline-controls')?.textContent).toContain(label)
    expect(view.range).toBeNull()
    await pointer('pointerup', xAt(from), true)
    expect(view.t).toBe(from)
    const chip = host.querySelector<HTMLButtonElement>('.eca-timeline-controls button[title="取消选段"]')
    expect(host.querySelector('button[title="编辑选段"]')?.textContent).toBe(label)
    expect(chip?.textContent).toBe('×')
    await act(() => chip!.click())
    expect(view.range).toBeNull()
    expect(view.t).toBe(from)
  })

  it('clears from compare, hits, and event range subtitles', async () => {
    await render(false, fixture, <><CompareTable /><HitAnalysis /><EventFeed /></>)
    for (const selector of ['.u7-compare-note', '.hit-analysis-controls', '.feed-title']) {
      await act(() => view.setRange([start + 30_000, start + 90_000]))
      const chip = host.querySelector<HTMLButtonElement>(`${selector} button[title="取消选段"]`)
      expect(chip).not.toBeNull()
      await act(() => chip!.click())
      expect(view.range).toBeNull()
    }
  })

  it('stays in the selection for scrubs and inside clicks, and clears it on an outside click', async () => {
    await render()
    const from = start + 40_000
    const to = start + 100_000
    await act(() => view.setRange([from, to]))
    const inside = start + 60_000
    const outside = start + 120_000
    await pointer('pointerdown', xAt(inside))
    await pointer('pointerup', xAt(inside))
    expect(view.range).toEqual([from, to])
    expect(view.t).toBe(inside)
    await pointer('pointerdown', xAt(inside))
    await pointer('pointermove', xAt(outside))
    await pointer('pointerup', xAt(outside))
    expect(view.range).toEqual([from, to])
    expect(view.t).toBe(to)
    await pointer('pointerdown', xAt(outside))
    await pointer('pointerup', xAt(outside))
    expect(view.range).toBeNull()
    expect(view.t).toBe(outside)
  })

  it('shows an empty lane prompt and hides pilot lanes in compact mode', async () => {
    await render()
    expect(host.textContent).toContain('在名单或对比里勾选飞行员，会出现在这里')
    const pilot = Object.values(fixture.analysis.entities).find(({ hasLog }) => hasLog)!
    await act(() => view.togglePin(pilot.key))
    expect(host.querySelectorAll('[data-pilot-lane]')).toHaveLength(1)
    await render(true)
    expect(host.querySelectorAll('[data-pilot-lane]')).toHaveLength(0)
    expect(host.textContent).not.toContain('在名单或对比里勾选飞行员，会出现在这里')
  })

  it('uses the same cursor and brush coordinates after zoom and switches lane metrics', async () => {
    await render()
    const pilot = Object.values(fixture.analysis.entities).find(({ hasLog }) => hasLog)!
    const observed = Object.values(fixture.analysis.entities).find(({ hasLog, charId }) => !hasLog && charId !== null)!
    const time = start + 60_000
    await act(() => {
      view.setPinned(new Set([pilot.key, observed.key]))
      view.setRange([time - 20_000, time + 20_000])
      view.seek(time)
    })
    const lane = () => host.querySelector('[data-pilot-lane]')!
    const expectAligned = () => {
      expect(lane().querySelector('svg')?.getAttribute('height')).toBe('46')
      expect(lane().querySelector('line[stroke="var(--color-accent)"]')?.getAttribute('x1')).toBe(
        chart().querySelector('line[stroke="var(--color-accent)"]')?.getAttribute('x1'))
      const brush = '[stroke-dasharray="3 3"]'
      expect(lane().querySelector(brush)?.getAttribute('x')).toBe(chart().querySelector(brush)?.getAttribute('x'))
      expect(lane().querySelector(brush)?.getAttribute('width')).toBe(chart().querySelector(brush)?.getAttribute('width'))
    }
    expectAligned()
    await act(() => chart().dispatchEvent(new WheelEvent('wheel', { deltaY: -180, clientX: xAt(time), bubbles: true, cancelable: true })))
    expectAligned()
    const curve = () => lane().querySelector('path[fill="none"]')
    const outgoing = curve()?.getAttribute('d')
    await click('承伤')
    expect(button('承伤').getAttribute('aria-pressed')).toBe('true')
    expect(curve()?.getAttribute('d')).not.toBe(outgoing)
    await click('维修输出')
    expect(curve()?.getAttribute('stroke')).toBe('var(--color-repair)')
    expect(lane().textContent).toContain('峰值')
    expect(host.querySelectorAll('[data-pilot-lane]')[1]?.textContent).toContain('据我方日志')
  })

  it('shares roster menu pins, compare checkboxes, and the lane remove button', async () => {
    await render(false, fixture, <><Roster /><CompareTable /></>)
    const pilot = Object.values(fixture.analysis.entities).find(({ hasLog, charId }) => hasLog && charId !== null)!
    const checkbox = () => [...host.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')]
      .find((node) => node.getAttribute('aria-label') === `并排对比 ${pilot.name}`)!
    await click(`${pilot.name} 的操作`)
    await click('加入时间轴对比')
    expect(checkbox().checked).toBe(true)
    expect(host.querySelectorAll('[data-pilot-lane]')).toHaveLength(1)
    await act(() => checkbox().click())
    expect(host.querySelectorAll('[data-pilot-lane]')).toHaveLength(0)
    await act(() => checkbox().click())
    await click(`移除 ${pilot.name} 的时间轴对比`)
    expect(checkbox().checked).toBe(false)
    expect(host.querySelectorAll('[data-pilot-lane]')).toHaveLength(0)
    await click(`${pilot.name} 的操作`)
    await click('加入时间轴对比')
    await click(`${pilot.name} 的操作`)
    await click('移出时间轴对比')
    expect(checkbox().checked).toBe(false)
  })

  it('opens the usage list from a focusable help button and returns focus on Escape', async () => {
    await render()
    const trigger = button('时间轴用法')
    expect(trigger?.textContent).toBe('?')
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    await act(() => trigger.focus())
    expect(document.activeElement).toBe(trigger)
    // jsdom does not translate a button's Enter/Space into its native click.
    await click('时间轴用法')
    const popover = host.querySelector('[role="dialog"].eca-timeline-help-popover')!
    expect(trigger.getAttribute('aria-expanded')).toBe('true')
    expect(trigger.getAttribute('aria-controls')).toBe(popover.id)
    expect(document.activeElement).toBe(popover)
    expect([...popover.querySelectorAll('li')].map((row) => row.textContent)).toEqual([
      '点击跳到某一刻',
      '拖动拖进度',
      'Shift+拖动选一段（只看这段），两端对齐到整秒。拖满 60 秒时对齐到 10 秒，按住 Alt 不对齐',
      'Esc 取消选段',
      '滚轮/双指缩放',
      '方向键逐秒，Shift+方向键以十秒为单位扩展选段',
      'Home/End 跳到当前视图的开头/结尾',
    ])
    const escape = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
    await act(() => popover.dispatchEvent(escape))
    expect(escape.defaultPrevented).toBe(true)
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
    expect(popover.hasAttribute('hidden')).toBe(true)
    expect(document.activeElement).toBe(trigger)
  })

  it('gives the help dialog a visible title and a close button that returns focus', async () => {
    await render()
    const trigger = button('时间轴用法')
    await click('时间轴用法')
    const dialog = host.querySelector('[role="dialog"]')!
    const title = dialog.querySelector('h2')
    expect(title?.textContent).toBe('时间轴使用说明')
    expect(dialog.getAttribute('aria-labelledby')).toBe(title?.id)
    expect(button('关闭时间轴使用说明').textContent).toBe('×')
    await click('关闭时间轴使用说明')
    expect(dialog.hasAttribute('hidden')).toBe(true)
    expect(document.activeElement).toBe(trigger)
  })

  it('remembers an explicitly dismissed first-visit hint across remounts', async () => {
    await render()
    expect(host.textContent).toContain('Shift+拖动可以只看一段')
    await click('关闭时间轴提示')
    expect(host.textContent).not.toContain('Shift+拖动可以只看一段')
    await act(() => root.unmount())
    root = createRoot(host)
    await render()
    expect(host.textContent).not.toContain('Shift+拖动可以只看一段')
  })

  it('keeps the hint on a click and dismisses it after a completed timeline drag', async () => {
    await render()
    const from = xAt(start + 30_000)
    const to = xAt(start + 60_000)
    await pointer('pointerdown', from)
    await pointer('pointerup', from)
    expect(host.textContent).toContain('Shift+拖动可以只看一段')
    await pointer('pointerdown', from, true)
    await pointer('pointermove', to, true)
    await pointer('pointerup', to, true)
    expect(view.range).toEqual([start + 30_000, start + 60_000])
    expect(host.textContent).not.toContain('Shift+拖动可以只看一段')
    await act(() => root.unmount())
    root = createRoot(host)
    await render()
    expect(host.textContent).not.toContain('Shift+拖动可以只看一段')
  })

  it('can dismiss the hint when browser storage is unavailable', async () => {
    const reject = () => { throw new Error('Storage disabled') }
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(reject)
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(reject)
    try {
      await render()
      expect(host.textContent).toContain('Shift+拖动可以只看一段')
      await click('关闭时间轴提示')
      expect(host.textContent).not.toContain('Shift+拖动可以只看一段')
    } finally {
      read.mockRestore()
      write.mockRestore()
    }
  })

  it('uses the accent token for the playback cursor stroke', async () => {
    await render()
    const cursor = chart().querySelector('g[pointer-events="none"] > line[stroke-width="2"]')
    expect(cursor?.getAttribute('stroke')).toBe('var(--color-accent)')
  })

  it('labels the next-event button outside compact mode and preserves its accessible name and icon', async () => {
    await render()
    expect(button('下一事件').textContent).toBe('下一事件')
    expect(button('下一事件').querySelector('svg[aria-hidden="true"]')).not.toBeNull()

    await render(true)
    const next = button('下一事件')
    expect(next.textContent).toBe('')
    expect(next.getAttribute('aria-label')).toBe('下一事件')
    expect(next.querySelector('svg[aria-hidden="true"]')).not.toBeNull()
  })

  it('sizes each enabled lane and disables icon mode when kills are off', async () => {
    await render()
    expect(height()).toBe(124)
    expect(lanes()).toEqual(['primary', 'damage', 'kills'])
    await click('我方维修')
    expect(height()).toBe(170)
    await click('点人')
    expect(lanes()).toEqual(['primary', 'damage', 'repair', 'point', 'kills'])
    expect(height()).toBe(204)
    await click('击毁用舰船图标')
    expect(height()).toBe(246)
    expect(chart().querySelector('[data-lane="kills"] image')).not.toBeNull()
    await click('击毁')
    expect(height()).toBe(186)
    expect(button('击毁用舰船图标').disabled).toBe(true)
    await click('我方伤害')
    await click('敌方伤害')
    expect(lanes()).toEqual(['primary', 'repair', 'point'])
    expect(height()).toBe(116)
  })

  it('uses only damage and kill ticks on a 64 px compact plot', async () => {
    await render(true)
    expect(height()).toBe(64)
    expect(lanes()).toEqual(['damage', 'kills'])
    expect(chart().querySelector('[data-lane="kills"] image')).toBeNull()
    expect(button('我方维修')).toBeUndefined()
  })

  it('gives each reported side its own damage curve and layer switch', async () => {
    // Synthetic third side for wiring coverage. J125990 itself has two sides.
    const analysis = {
      ...fixture.analysis,
      coverage: [...fixture.analysis.coverage, { side: 2, known: 1, withLog: 0 }],
      timeline: { ...fixture.analysis.timeline, damageBySide: { ...fixture.analysis.timeline.damageBySide, 2: [1] } },
    }
    await render(false, { ...fixture, analysis })
    const curve = (side: number) => chart().querySelector(`[data-damage-side="${side}"]`)
    expect(curve(1)?.getAttribute('stroke')).toBe('var(--color-side-0)')
    expect(curve(0)?.getAttribute('stroke')).toBe('var(--color-side-1)')
    expect(curve(2)?.getAttribute('stroke')).toBe('var(--color-side-2)')
    await click('C 方伤害')
    expect(curve(2)).toBeNull()
    expect(curve(0)).not.toBeNull()
  })

  it('renders primary groups for different sides at the same target and time without a key warning', async () => {
    const primary = fixture.analysis.primaries[0]!
    // Synthetic second side with the same target and bounds as the real span.
    const otherSide = { ...primary, bySide: primary.bySide === 0 ? 1 : 0 }
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await act(() => root.render(
        <svg>
          <Plot width={1000} height={124} left={72} right={12} start={start} end={end} bucketStart={start}
            lanes={[{ id: 'primary', top: 6, height: 14, label: '主目标' }]} compact={false} zoomed={false}
            killIcons={false} summary={fixture.summary} analysis={fixture.analysis} order={[1, 0]}
            damage={[]} repair={[]} point={[]} primaries={[primary, otherSide]} />
        </svg>,
      ))
      expect(host.querySelectorAll('[data-lane="primary"] g > title')).toHaveLength(2)
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('renders both overlapping J125990 primaries after switching perspective without a key warning', async () => {
    await render()
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await act(() => view.setOursSide(0))
      const name = fixture.analysis.entities['char:2115160605']!.name
      const titles = [...chart().querySelectorAll('[data-lane="primary"] title')].map((title) => title.textContent)
      expect(titles).toContain(`主目标 ${name} · 2 人`)
      expect(titles).toContain(`主目标 ${name} · 3 人`)
      expect(consoleError).not.toHaveBeenCalled()
    } finally {
      consoleError.mockRestore()
    }
  })

  it('seeks on click, scrubs on drag, and publishes an ordered range cleared by Escape', async () => {
    await render()
    await pointer('pointerdown', xAt(start + 30_000))
    await pointer('pointerup', xAt(start + 30_000))
    expect(view.t).toBe(start + 30_000)
    await pointer('pointerdown', xAt(start + 35_000))
    await pointer('pointermove', xAt(start + 60_000))
    expect(view.t).toBe(start + 60_000)
    await pointer('pointerup', xAt(start + 65_000))
    expect(view.t).toBe(start + 65_000)
    await pointer('pointerdown', xAt(start + 120_000), true)
    await pointer('pointermove', xAt(start + 80_000), true)
    await pointer('pointerup', xAt(start + 80_000), true)
    expect(view.range).toEqual([start + 80_000, start + 120_000])
    expect(chart().querySelector('[stroke-dasharray="3 3"]')).not.toBeNull()
    expect(view.t).toBe(start + 80_000)
    await act(() => chart().dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })))
    expect(view.range).toBeNull()
  })

  it('extends or shrinks a keyboard range from the cursor and clears it with Escape', async () => {
    await render()
    const cursor = start + 30_000
    await act(() => view.seek(cursor))
    await act(() => chart().focus())
    const key = (name: string, shiftKey = false) => act(() => chart().dispatchEvent(
      new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, shiftKey }),
    ))
    await key('ArrowRight', true)
    expect(view.range).toEqual([cursor, cursor + 10_000])
    await key('ArrowUp', true)
    expect(view.range).toEqual([cursor, cursor + 20_000])
    await key('ArrowLeft', true)
    expect(view.range).toEqual([cursor, cursor + 10_000])
    expect(view.t).toBe(cursor)
    expect(chart().querySelector('[stroke-dasharray="3 3"]')).not.toBeNull()
    await key('Escape')
    expect(view.range).toBeNull()
    await key('ArrowDown', true)
    expect(view.range).toEqual([cursor - 10_000, cursor])
    await key('ArrowUp', true)
    expect(view.range).toBeNull()
    expect(view.t).toBe(cursor)
    await key('ArrowDown', true)
    await key('ArrowRight')
    expect(view.t).toBe(cursor - 9000)
  })

  it('shows and describes the timeline readout at the keyboard cursor until blur', async () => {
    await render()
    await act(() => view.seek(start + 30_000))
    expect(host.querySelector('[role="tooltip"]')).toBeNull()
    await act(() => chart().focus())
    const tip = () => host.querySelector('[role="tooltip"]')
    expect(tip()?.querySelector('time')?.textContent).toBe(fmtHms(start + 30_000))
    expect(chart().getAttribute('aria-describedby')).toBe(tip()?.id)
    await act(() => chart().dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight', bubbles: true, cancelable: true,
    })))
    expect(tip()?.querySelector('time')?.textContent).toBe(fmtHms(start + 31_000))
    await act(() => chart().blur())
    expect(tip()).toBeNull()
    expect(chart().hasAttribute('aria-describedby')).toBe(false)
  })

  it('zooms around the wheel and pinch anchors', async () => {
    await render()
    const center = xAt(start + (end - start) / 2)
    const span = () => Number(chart().dataset.domainEnd) - Number(chart().dataset.domainStart)
    const wheel = new WheelEvent('wheel', { deltaY: -300, clientX: center, bubbles: true, cancelable: true })
    await act(() => chart().dispatchEvent(wheel))
    expect(wheel.defaultPrevented).toBe(true)
    expect(span()).toBeLessThan(end - start)
    expect((Number(chart().dataset.domainStart) + Number(chart().dataset.domainEnd)) / 2).toBeCloseTo((start + end) / 2)
    const afterWheel = span()
    await pointer('pointerdown', center - 51, false, 1, 'touch')
    await pointer('pointermove', center - 50, false, 1, 'touch')
    await pointer('pointerdown', center + 50, false, 2, 'touch')
    await pointer('pointermove', center + 150, false, 2, 'touch')
    expect(span()).toBeCloseTo(afterWheel / 2)
    await pointer('pointerup', center - 50, false, 1, 'touch')
    await pointer('pointerup', center + 150, false, 2, 'touch')
    expect(view.t).toBe(start)
  })

  it('reads the real raw damage and current primary at the hovered second', async () => {
    await render()
    const primary = fixture.analysis.primaries.find(({ bySide, start: t }) => bySide === 1 && t > start)!
    const i = (primary.start - start) / 1000
    await pointer('pointermove', xAt(primary.start))
    const tip = host.querySelector('[role="tooltip"]')!
    for (const side of [1, 0]) {
      const value = fixture.analysis.timeline.damageBySide[side]![i]
      const readout = tip.querySelector(`[data-readout-side="${side}"]`)!
      expect(readout.querySelector('.app-number')?.textContent).toBe(fmtNum(value))
      expect(readout.textContent).toContain('/秒')
    }
    expect(tip.textContent).toContain(fixture.analysis.entities[primary.target]!.name)
    expect(tip.textContent).toContain(String(primary.shooters.length))
  })

  it('skips to the next recorded event and cycles the shared playback speed', async () => {
    await render()
    const next = fixture.analysis.interactions.find(({ t }) => t > view.t)!
    await click('下一事件')
    expect(view.t).toBe(next.t)
    for (const speed of [1, 2, 4, 8]) {
      expect(view.speed).toBe(speed)
      await click(`${speed}×`)
    }
    expect(view.speed).toBe(1)
    await click('播放')
    expect(view.playing).toBe(true)
    await click('暂停')
    expect(view.playing).toBe(false)
  })
})
