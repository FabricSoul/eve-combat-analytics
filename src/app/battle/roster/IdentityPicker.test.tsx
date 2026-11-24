// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Analysis, BattleSummary, Interaction } from '@/core/contract'
import { api } from '../../api/client'
import { BattleUndo } from '../undo'
import { Roster } from '../Roster'
import { useView } from '../../state/view-store'
import { entity, mountApp, stats, tinyAnalysis, tinySummary } from './testing'

let mounted: ReturnType<typeof mountApp>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.spyOn(api, 'putIdentity').mockResolvedValue({ from: 'name:Hidden', to: 'char:2', setAt: 1 })
})
afterEach(() => { mounted?.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const hit = (t: number, from: string, logId: string): Interaction => ({
  t, from: from as Interaction['from'], to: 'char:4', kind: 'damage', amount: 10, weapon: null, quality: null,
  repairType: null, ewar: null, sources: [{ logId, line: t }], corroborated: false,
})
// Hidden fights 0–10 s; Pilot2 overlaps 9 s, Pilot1 2 s, Pilot3 never shows up.
const analysis: Analysis = {
  ...tinyAnalysis,
  entities: { ...tinyAnalysis.entities, 'name:Hidden': { key: 'name:Hidden', name: 'Hidden', charId: null, side: 0, sideSource: 'br', shipTypes: ['Leshak'], hasLog: false } },
  interactions: [hit(0, 'name:Hidden', 'a'), hit(10_000, 'name:Hidden', 'a'), hit(0, 'char:1', 'b'), hit(2_000, 'char:1', 'b'), hit(1_000, 'char:2', 'c'), hit(9_000, 'char:2', 'c')],
  stats: [...tinyAnalysis.stats.map((s) => s.key === 'char:2' ? { ...s, source: 'observed' as const } : s), stats(7, 0)],
}
const mount = (summary: BattleSummary = tinySummary, data: Analysis = analysis) => {
  mounted = mountApp(createElement(Roster), { summary, analysis: data })
}
const row = (name: string) => [...mounted.container.querySelectorAll<HTMLElement>('.roster-row')].find((r) => r.textContent?.includes(name))!
const picker = () => document.querySelector<HTMLElement>('[role="dialog"]')
const openPicker = () => {
  act(() => row('Hidden').querySelector<HTMLButtonElement>('.roster-more')!.click())
  act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === '这是谁…')!.click())
}

describe('IdentityPicker', () => {
  it('unidentified rows get a 这是谁… menu; characters do not', () => {
    mount()
    act(() => row('Hidden').querySelector<HTMLButtonElement>('.roster-more')!.click())
    expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).toEqual(['这是谁…', '看他的回放'])
    act(() => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    act(() => row('Pilot1').querySelector<HTMLButtonElement>('.roster-more')!.click())
    expect([...document.querySelectorAll('[role="menuitem"]')].map((b) => b.textContent)).not.toContain('这是谁…')
  })

  it('lists suggestions best overlap first, with portrait, ship and why', () => {
    mount()
    openPicker()
    const items = [...picker()!.querySelectorAll<HTMLElement>('[data-suggestion]')]
    expect(items.map((i) => i.querySelector('.identity-name')?.textContent)).toEqual(['Pilot2', 'Pilot1'])
    expect(items[0]!.textContent).toContain('同阵营 · 同船型 · 同时在场')
    expect(items[0]!.textContent).toContain('Leshak')
    expect(items[0]!.querySelector('img.app-portrait')).not.toBeNull()
  })

  it('caps suggestions at five', () => {
    const many = Object.fromEntries(Array.from({ length: 8 }, (_, i) => entity(20 + i, 0)).map((e) => [e.key, e]))
    mount(tinySummary, {
      ...analysis, entities: { ...analysis.entities, ...many },
      interactions: [...analysis.interactions, ...Array.from({ length: 8 }, (_, i) => hit(500 * i, `char:${20 + i}`, `x${i}`)), ...Array.from({ length: 8 }, (_, i) => hit(5_000 + i, `char:${20 + i}`, `y${i}`))],
    })
    openPicker()
    expect(picker()!.querySelectorAll('[data-suggestion]').length).toBe(5)
  })

  it('searches every known character, not only suggestions', () => {
    mount()
    openPicker()
    const input = picker()!.querySelector<HTMLInputElement>('input[type="search"]')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'pilot6')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const found = [...picker()!.querySelectorAll('[data-result] .identity-name')].map((n) => n.textContent)
    expect(found).toEqual(['Pilot6'])
  })

  it('choosing a candidate calls putIdentity and closes', async () => {
    mount()
    openPicker()
    await act(async () => picker()!.querySelector<HTMLButtonElement>('[data-suggestion]')!.click())
    expect(api.putIdentity).toHaveBeenCalledWith('tiny', 'name:Hidden', 'char:2')
    expect(picker()).toBeNull()
  })

  it('is keyboard operable: arrows highlight a candidate, Enter picks it, Escape closes', async () => {
    mount()
    openPicker()
    const input = picker()!.querySelector<HTMLInputElement>('input')!
    expect(document.activeElement).toBe(input)
    const press = (key: string) => act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })) })
    expect(picker()!.querySelector('[data-active]')).toBeNull()
    press('ArrowDown')
    expect(picker()!.querySelector('[data-active] .identity-name')?.textContent).toBe('Pilot2')
    press('ArrowDown')
    expect(picker()!.querySelector('[data-active] .identity-name')?.textContent).toBe('Pilot1')
    press('ArrowUp')
    press('ArrowUp')
    expect(picker()!.querySelector('[data-active] .identity-name')?.textContent).toBe('Pilot1')
    press('ArrowDown')
    expect(input.getAttribute('aria-activedescendant')).toBe(picker()!.querySelector('[data-active]')!.id)
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(api.putIdentity).toHaveBeenCalledWith('tiny', 'name:Hidden', 'char:2')
  })

  it('Escape closes the picker without saving', () => {
    mount()
    openPicker()
    act(() => { picker()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(picker()).toBeNull()
    expect(api.putIdentity).not.toHaveBeenCalled()
  })

  it('pre-highlights the first search result so typing then Enter picks it', async () => {
    mount()
    openPicker()
    const input = picker()!.querySelector<HTMLInputElement>('input')!
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'pilot6')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(picker()!.querySelector('[data-active] .identity-name')?.textContent).toBe('Pilot6')
    await act(async () => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(api.putIdentity).toHaveBeenCalledWith('tiny', 'name:Hidden', 'char:6')
  })

  it('closes at once on pick; the merge shows and the toast names both and offers 撤销 before the server answers', async () => {
    vi.spyOn(api, 'putIdentity').mockReturnValue(new Promise(() => {}))
    mounted = mountApp(createElement(BattleUndo, null, createElement(Roster)), { summary: tinySummary, analysis })
    act(() => row('Hidden').querySelector<HTMLButtonElement>('.roster-more')!.click())
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === '这是谁…')!.click())
    await act(async () => picker()!.querySelector<HTMLButtonElement>('[data-suggestion]')!.click())
    expect(picker()).toBeNull()
    expect([...mounted.container.querySelectorAll('.roster-row')].some((r) => r.textContent?.includes('Hidden'))).toBe(false)
    expect(row('Pilot2').querySelector('.app-tag')?.textContent).toBe('合并')
    expect(document.querySelector('[data-battle-toast]')?.textContent).toBe('已合并 Hidden → Pilot2撤销')
  })

  it('rolls the merge back and says so when the call fails', async () => {
    let fail!: () => void
    vi.spyOn(api, 'putIdentity').mockReturnValue(new Promise((_, reject) => { fail = () => reject(new Error('x')) }))
    mounted = mountApp(createElement(BattleUndo, null, createElement(Roster)), { summary: tinySummary, analysis })
    act(() => row('Hidden').querySelector<HTMLButtonElement>('.roster-more')!.click())
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === '这是谁…')!.click())
    await act(async () => picker()!.querySelector<HTMLButtonElement>('[data-suggestion]')!.click())
    await act(async () => fail())
    expect(row('Hidden')).toBeDefined()
    expect(row('Pilot2').querySelector('.app-tag')).toBeNull()
    expect(document.querySelector('[role="alert"]')).not.toBeNull()
    expect(document.querySelector('[data-battle-toast]')).toBeNull()
  })

  it('撤销 straight away reverts the optimistic merge and sends the removal after the first call settles', async () => {
    let finish!: () => void
    const put = vi.spyOn(api, 'putIdentity').mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ from: 'name:Hidden', to: 'char:2', setAt: 1 }) }))
      .mockResolvedValue({ removed: 'name:Hidden' })
    mounted = mountApp(createElement(BattleUndo, null, createElement(Roster)), { summary: tinySummary, analysis })
    act(() => row('Hidden').querySelector<HTMLButtonElement>('.roster-more')!.click())
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === '这是谁…')!.click())
    await act(async () => picker()!.querySelector<HTMLButtonElement>('[data-suggestion]')!.click())
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[data-battle-toast] button')].find((b) => b.textContent === '撤销')!.click())
    expect(row('Pilot2').querySelector('.app-tag')).toBeNull()
    expect(put).toHaveBeenCalledTimes(1)
    await act(async () => finish())
    expect(put).toHaveBeenLastCalledWith('tiny', 'name:Hidden', null)
  })

  it('scrolls the merged pilot into view inside the list and flashes it once', async () => {
    vi.useFakeTimers()
    vi.spyOn(api, 'putIdentity').mockResolvedValue({ from: 'name:Hidden', to: 'char:2', setAt: 1 })
    mount()
    act(() => row('Hidden').querySelector<HTMLButtonElement>('.roster-more')!.click())
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === '这是谁…')!.click())
    await act(async () => picker()!.querySelector<HTMLButtonElement>('[data-suggestion]')!.click())
    expect(row('Pilot2').hasAttribute('data-flash')).toBe(true)
    await act(async () => { vi.advanceTimersByTime(2000) })
    expect(row('Pilot2').hasAttribute('data-flash')).toBe(false)
    vi.useRealTimers()
  })

  it('labels a merged character with its merge time and keeps undo in the pilot menu', async () => {
    const merged = { ...tinySummary, identityMerges: [{ from: 'name:Hidden' as const, to: 'char:2' as const, setAt: Date.UTC(2025, 5, 22, 15, 42) }] }
    mount(merged, tinyAnalysis)
    const pilot = row('Pilot2')
    const tag = pilot.querySelector('.app-tag')!
    expect(tag.tagName).toBe('SPAN')
    expect(tag.textContent).toBe('合并')
    expect(tag.getAttribute('title')).toBe('合并 · 2025-06-22 15:42 UTC 设')
    expect(pilot.querySelectorAll('button')).toHaveLength(2)
    act(() => pilot.querySelector<HTMLButtonElement>('.roster-more')!.click())
    const undo = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent?.startsWith('取消合并'))!
    await act(async () => undo.click())
    expect(api.putIdentity).toHaveBeenCalledWith('tiny', 'name:Hidden', null)
  })

  it('live update: a new identityMerges list re-renders the tag', () => {
    mount()
    expect(row('Pilot2').querySelector('.app-tag')).toBeNull()
    mounted.rerender(createElement(Roster), { summary: { ...tinySummary, identityMerges: [{ from: 'name:Hidden', to: 'char:2', setAt: 5 }] }, analysis: tinyAnalysis })
    expect(row('Pilot2').querySelector('.app-tag')?.textContent).toBe('合并')
  })

  it('log-inferred sides show 据日志 with the reason for non-uploaders too', () => {
    const noLog = { ...tinyAnalysis, entities: { ...tinyAnalysis.entities, 'char:2': entity(2, 0, { sideSource: 'log' }) },
      sideOverrides: [{ subject: 'char:2' as const, side: 0, source: 'log' as const, reason: 'observed damaged side 1: 12 events', setAt: 0 }] }
    mount(tinySummary, noLog)
    const tag = row('Pilot2').querySelector('.app-tag')!
    expect(tag.textContent).toBe('据日志')
    expect(tag.getAttribute('title')).toBe('据日志：伤害了 敌方 12 次')
  })

  it('gives observed pilots a hover and omits it for BR-only pilots', () => {
    // Synthetic BR-only stat row for Pilot5, who has no interaction in this fixture.
    const data: Analysis = { ...analysis, stats: analysis.stats.map((entry) =>
      entry.key === 'char:5' ? { ...stats(5, 0), source: 'observed', killmailCount: 1 } : entry) }
    mount(tinySummary, data)
    expect.soft(row('Pilot5').querySelector('.roster-dot')?.getAttribute('title')).toBeNull()
    expect.soft(row('Pilot2').querySelector('.roster-dot')?.getAttribute('title')).toBe('没有日志 · 数据据他人日志')
    expect(row('Pilot1').querySelector('.roster-dot')?.getAttribute('title')).toBeNull()
  })
})

describe('selection', () => {
  it('moves the selection from the merged entity to the character it became', async () => {
    let view!: ReturnType<typeof useView>
    function Probe() { view = useView(); return null }
    mounted = mountApp(createElement('div', null, createElement(Probe), createElement(Roster)), { summary: tinySummary, analysis })
    act(() => view.select('name:Hidden'))
    act(() => row('Hidden').querySelector<HTMLButtonElement>('.roster-more')!.click())
    act(() => [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((b) => b.textContent === '这是谁…')!.click())
    await act(async () => picker()!.querySelector<HTMLButtonElement>('[data-suggestion]')!.click())
    expect(view.selected).toBe('char:2')
  })
})

describe('menu entry points', () => {
  it('keeps the row ⋯ faintly visible, not hover-only', async () => {
    const { readFileSync } = await import('node:fs')
    const css = readFileSync('src/app/battle/roster/roster.css', 'utf8')
    const rule = /\n\.roster-more \{[^}]*\}/.exec(css)![0]
    expect(rule).not.toMatch(/opacity:\s*0\s*;/)
  })
})
