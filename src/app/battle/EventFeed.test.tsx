// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Analysis, Interaction } from '@/core/contract'
import { fmtHms } from '../lib/format'
import { EventFeed } from './EventFeed'
import { useView } from '../state/view-store'
import { mountApp, tinyAnalysis, tinySummary } from './roster/testing'

const T = Date.UTC(2025, 5, 22, 15, 43, 2)
const hit = (t: number, from: number, to: number, patch: Partial<Interaction> = {}): Interaction => ({
  t, from: `char:${from}`, to: `char:${to}`, kind: 'damage', amount: 100, weapon: 'Heavy Missile', quality: null,
  repairType: null, ewar: null, sources: [], corroborated: false, ...patch,
})
const analysis: Analysis = {
  ...tinyAnalysis,
  interactions: [
    hit(T - 5_000, 1, 4), hit(T - 3_000, 1, 4, { amount: 250 }),
    hit(T - 2_000, 5, 2, { kind: 'repair', repairType: 'armor', weapon: null, amount: 40 }), hit(T - 1_000, 1, 4),
  ],
  primaries: [{ target: 'char:4', bySide: 0, start: T - 8_000, end: T, killedAt: null, damage: 1, shooters: ['char:1', 'char:2'] }],
}
const summary = { ...tinySummary, meta: { ...tinySummary.meta, killmails: tinySummary.meta.killmails.map((k) => ({ ...k, t: T - 500 })) } }

let mounted: ReturnType<typeof mountApp>
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(() => { mounted?.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const mount = (props: { compact?: boolean; search?: boolean; onSearchClose?: () => void } = {}) => {
  mounted = mountApp(createElement(EventFeed, props), { summary, analysis }, { initialTime: T })
  return mounted.container
}
const headers = (el: HTMLElement) => [...el.querySelectorAll('.feed-head > span')].map((s) => s.textContent)
const rows = (el: HTMLElement) => [...el.querySelectorAll<HTMLElement>('.feed-row')]
const mode = (el: HTMLElement, label: string) => act(() =>
  [...el.querySelectorAll<HTMLButtonElement>('.feed-modes button')].find((b) => b.textContent === label)!.click())

describe('EventFeed', () => {
  it('merged: column headers, last time, count ×n and total, newest row current', () => {
    const el = mount()
    expect(headers(el)).toEqual(['最后时间', '出手', '用', '对象', '总量 ×次数'])
    const [first, second] = rows(el)
    expect(first?.textContent).toContain(fmtHms(T - 1_000))
    expect(first?.textContent).toContain('Pilot1')
    expect(first?.textContent).toContain('Pilot4')
    expect(first?.querySelector('.feed-amount')?.textContent).toBe('450 ×3')
    expect(first?.getAttribute('aria-current')).toBe('true')
    expect(second?.hasAttribute('aria-current')).toBe(false)
    expect(second?.querySelector('.feed-amount')?.textContent).toBe('40')
    expect(rows(el)).toHaveLength(2)
  })

  it('shows who with a portrait; the weapon falls back to a kind label with the module name on hover', () => {
    const el = mount()
    const first = rows(el)[0]!
    expect(first.querySelector('.feed-who img')?.getAttribute('src')).toContain('/characters/1/portrait')
    expect(first.querySelector('.feed-who i')).not.toBeNull()
    expect(first.querySelector('.feed-weapon')).toMatchObject({ textContent: '打', title: 'Heavy Missile' })
    expect(rows(el)[1]?.querySelector('.feed-weapon')?.textContent).toBe('修')
  })

  it('raw: one row per event with 时间 / 数值 headers', () => {
    const el = mount()
    mode(el, '逐条')
    expect(headers(el)).toEqual(['时间', '出手', '用', '对象', '数值'])
    expect(rows(el)).toHaveLength(4)
    expect(rows(el)[0]?.querySelector('.feed-amount')?.textContent).toBe('100')
  })

  it('key: killmails, our primary switches and big hits under 时间 / 事件', () => {
    const el = mount()
    mode(el, '只看关键')
    expect(headers(el)).toEqual(['时间', '', '事件'])
    const text = rows(el).map((r) => r.textContent)
    expect(text.some((t) => t?.includes('被击毁') && t.includes('3.0 亿'))).toBe(true)
    expect(text.some((t) => t?.includes('主目标换成') && t.includes('2 人在打'))).toBe(true)
  })

  it('compact: time separator rows instead of a time column', () => {
    const el = mount({ compact: true })
    expect(headers(el)).toEqual(['出手', '用', '对象', '总量 ×次数'])
    expect([...el.querySelectorAll('.feed-sep')].map((s) => s.textContent)).toEqual([fmtHms(T - 1_000), fmtHms(T - 2_000)])
    expect(rows(el)[0]?.querySelector('.feed-time')).toBeNull()
  })

  it('switches to compact when its column is no wider than 400', () => {
    let notify!: () => void
    let width = 460
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { notify = cb } observe() {} disconnect() {} })
    const el = mount()
    const root = el.querySelector<HTMLElement>('.feed')!
    vi.spyOn(root, 'clientWidth', 'get').mockImplementation(() => width)
    act(() => notify())
    expect(el.querySelector('.feed-sep')).toBeNull()
    width = 400
    act(() => notify())
    expect(el.querySelector('.feed-sep')).not.toBeNull()
  })

  it('says so when nothing happened in the window', () => {
    mounted = mountApp(createElement(EventFeed), { summary, analysis: { ...analysis, interactions: [] } }, { initialTime: T })
    expect(mounted.container.textContent).toContain('没有事件')
  })
})

describe('EventFeed search', () => {
  it('Esc clears the text first, then closes the search', () => {
    const close = vi.fn()
    const el = mount({ search: true, onSearchClose: close })
    const input = el.querySelector<HTMLInputElement>('input[type="search"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'zzz')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(input.value).toBe('')
    expect(close).not.toHaveBeenCalled()
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(close).toHaveBeenCalledOnce()
  })
})

describe('EventFeed module icons', () => {
  it('shows the module icon once the item table has loaded', async () => {
    mounted = mountApp(createElement(EventFeed), {
      summary,
      analysis: { ...analysis, interactions: [hit(T - 1_000, 1, 4, { weapon: 'Heavy Missile Launcher II' })] },
    }, { initialTime: T })
    await vi.waitFor(async () => {
      await act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })
      expect(mounted.container.querySelector('.feed-weapon img')?.getAttribute('src')).toContain('/types/2410/icon')
    }, { timeout: 3000 })
  })
})

describe('EventFeed range, focus and scope', () => {
  it('labels key mode with its real time scope and follows the Shift-drag range', () => {
    let view!: ReturnType<typeof useView>
    function Probe() { view = useView(); return null }
    mounted = mountApp(createElement('div', null, createElement(EventFeed), createElement(Probe)), { summary, analysis }, { initialTime: T })
    const el = mounted.container
    expect(el.querySelector('.feed-at')?.textContent).toBe(`${fmtHms(T)} 之前 10 秒`)
    mode(el, '只看关键')
    expect(el.querySelector('.feed-at')?.textContent).toBe(`${fmtHms(T)} 之前的关键事件`)
    act(() => view.setRange([T - 4_000, T - 2_500]))
    const scoped = () => el.querySelector('.feed-title .battle-range-chip')?.textContent
    expect(scoped()).toBe(`选段 ${fmtHms(T - 4_000)}–${fmtHms(T - 4_000)} 内的关键事件 ×`)
    act(() => view.seek(T))
    expect(scoped()).toBe(`选段 ${fmtHms(T - 4_000)}–${fmtHms(T - 2_500)} 内的关键事件 ×`)
    mode(el, '逐条')
    expect(rows(el).map((r) => r.querySelector('.feed-time')?.textContent)).toEqual([fmtHms(T - 3_000)])
  })

  it('只看他 narrows key mode too', () => {
    let view!: ReturnType<typeof useView>
    function Probe() { view = useView(); return null }
    mounted = mountApp(createElement('div', null, createElement(EventFeed), createElement(Probe)), { summary, analysis }, { initialTime: T })
    mode(mounted.container, '只看关键')
    expect(rows(mounted.container).length).toBeGreaterThan(1)
    act(() => { view.select('char:2'); view.setFocusOnly(true) })
    expect(rows(mounted.container).some((r) => r.textContent?.includes('主目标换成'))).toBe(true)
    act(() => view.select('char:6')) // takes no part in any key event
    act(() => view.setFocusOnly(true))
    expect(rows(mounted.container)).toHaveLength(0)
  })
})

describe('EventFeed amounts and current row', () => {
  it('prints 0 for a real zero amount and — only for kinds that carry no amount', () => {
    const extra: Analysis = {
      ...analysis,
      interactions: [
        hit(T - 4_000, 1, 4, { amount: 0 }),
        hit(T - 2_000, 1, 4, { kind: 'ewar', ewar: 'warp_scramble', weapon: null, amount: 0 }),
        hit(T - 1_000, 5, 2, { kind: 'neut', amount: 0 }),
      ],
    }
    mounted = mountApp(createElement(EventFeed), { summary, analysis: extra }, { initialTime: T })
    const amounts = Object.fromEntries(rows(mounted.container).map((r) => [r.getAttribute('data-kind'), r.querySelector('.feed-amount')?.textContent]))
    expect(amounts).toEqual({ damage: '0', ewar: '—', neut: '0' })
  })

  it('draws the gold left rule on the current row from the accent-line token', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/app/battle/feed/feed.css', 'utf8')
    const rule = /\.feed-row\[aria-current="true"\]::before\s*\{([^}]*)\}/.exec(css)?.[1] ?? ''
    expect(rule).toContain('var(--color-accent-line)')
    expect(rule).toMatch(/width:\s*2px/)
    expect(rule).toMatch(/inset-inline-start:\s*0/)
  })
})
