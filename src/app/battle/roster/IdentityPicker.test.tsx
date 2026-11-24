// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Analysis, BattleSummary, Interaction } from '@/core/contract'
import { api } from '../../api/client'
import { Roster } from '../Roster'
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

  it('is keyboard operable: arrows move through candidates, Enter picks, Escape closes', async () => {
    mount()
    openPicker()
    const input = picker()!.querySelector<HTMLInputElement>('input')!
    expect(document.activeElement).toBe(input)
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    const second = [...picker()!.querySelectorAll<HTMLButtonElement>('[data-suggestion]')]
    act(() => { (document.activeElement as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(document.activeElement).toBe(second[1])
    await act(async () => { second[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); second[1]!.click() })
    expect(api.putIdentity).toHaveBeenCalledWith('tiny', 'name:Hidden', 'char:1')
    openPicker()
    act(() => { picker()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(picker()).toBeNull()
  })

  it('shows the failure and stays open when the call fails', async () => {
    vi.spyOn(api, 'putIdentity').mockRejectedValue(new Error('x'))
    mount()
    openPicker()
    await act(async () => picker()!.querySelector<HTMLButtonElement>('[data-suggestion]')!.click())
    expect(picker()!.querySelector('[role="alert"]')).not.toBeNull()
  })

  it('a merged character carries a 合并 tag with the time, and 取消合并 removes it', async () => {
    const merged = { ...tinySummary, identityMerges: [{ from: 'name:Hidden' as const, to: 'char:2' as const, setAt: Date.UTC(2025, 5, 22, 15, 42) }] }
    mount(merged, tinyAnalysis)
    const tag = row('Pilot2').querySelector('.app-tag')!
    expect(tag.textContent).toBe('合并')
    expect(tag.getAttribute('title')).toContain('15:42')
    act(() => row('Pilot2').querySelector<HTMLButtonElement>('.roster-more')!.click())
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
    expect(tag.getAttribute('title')).toBe('observed damaged side 1: 12 events')
  })

  it('observed pilots get a hover that says the numbers come from our logs', () => {
    mount()
    expect(row('Pilot2').querySelector('.roster-dot')?.getAttribute('title')).toContain('据我方日志')
    expect(row('Pilot1').querySelector('.roster-dot')?.getAttribute('title')).toBeNull()
  })
})
