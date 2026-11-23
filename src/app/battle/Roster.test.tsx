// @vitest-environment jsdom
import { act, createElement } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../api/client'
import { useView } from '../state/view-store'
import { Roster } from './Roster'
import { mountApp, tinyAnalysis, tinySummary } from './roster/testing'

let mounted: ReturnType<typeof mountApp>
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(() => { mounted?.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const rows = () => [...mounted.container.querySelectorAll<HTMLElement>('.roster-row')]
const names = () => rows().map((row) => row.querySelector('.roster-name')?.textContent)
const row = (name: string) => rows().find((r) => r.textContent?.includes(name))!

describe('Roster', () => {
  it('orders ours with logs first, then the rest of ours, then the other sides, then 未分边', () => {
    mounted = mountApp(createElement(Roster))
    expect(names()).toEqual(['Pilot3', 'Pilot1', 'Pilot2', 'Pilot5', 'Pilot4', 'Pilot6'])
    expect([...mounted.container.querySelectorAll('h3')].map((h) => h.textContent)).toEqual([
      '我方 · 有日志 23', '敌方2', '未分边1',
    ])
  })

  it('shows every row state: log dot, dead, tags with their reason, ship', () => {
    mounted = mountApp(createElement(Roster))
    expect(row('Pilot1').hasAttribute('data-nolog')).toBe(false)
    expect(row('Pilot2').hasAttribute('data-nolog')).toBe(true)
    expect(row('Pilot4').hasAttribute('data-dead')).toBe(true)
    expect(row('Pilot5').hasAttribute('data-dead')).toBe(false)
    expect(row('Pilot3').querySelector('.app-tag')).toMatchObject({ textContent: '据日志', title: 'repaired side 0: 842 events' })
    expect(row('Pilot5').querySelector('.app-tag')?.textContent).toBe('手动')
    expect(row('Pilot1').querySelector('.app-tag')).toBeNull()
    expect(row('Pilot1').textContent).toContain('Leshak')
    expect(row('Pilot1').querySelector('img.app-type-icon')?.getAttribute('src')).toContain('/types/47271/icon')
  })

  it('lists ship: and name: pilots after the characters, with a placeholder portrait, the key\'s ship and no menu', () => {
    const extra = [
      { key: 'ship:587:1', name: 'Rifter', charId: null, side: 1, sideSource: 'br', shipTypes: ['Rifter'], hasLog: false },
      { key: 'name:Hidden', name: 'Hidden', charId: null, side: 1, sideSource: 'br', shipTypes: ['Leshak'], hasLog: false },
    ] as const
    mounted = mountApp(createElement(Roster), {
      summary: tinySummary,
      analysis: { ...tinyAnalysis, entities: { ...tinyAnalysis.entities, ...Object.fromEntries(extra.map((e) => [e.key, { ...e, shipTypes: [...e.shipTypes] }])) } },
    })
    expect(names()).toEqual(['Pilot3', 'Pilot1', 'Pilot2', 'Pilot5', 'Pilot4', 'Hidden', 'Rifter', 'Pilot6'])
    const ship = row('Rifter')
    expect(ship.querySelector('img.app-portrait')).toBeNull()
    expect(ship.querySelector('span.app-portrait')).not.toBeNull()
    expect(ship.querySelector('img.app-type-icon')?.getAttribute('src')).toContain('/types/587/icon')
    expect(ship.querySelector('.roster-more')).toBeNull()
  })

  it('orders by stats of the Shift-drag range when one is set', () => {
    let view!: ReturnType<typeof useView>
    function Probe() { view = useView(); return null }
    const T = 1_000_000
    const hit = (t: number, from: number, amount: number) => ({
      t, from: `char:${from}` as const, to: 'char:4' as const, kind: 'damage' as const, amount, weapon: null, quality: null,
      repairType: null, ewar: null, sources: [], corroborated: false,
    })
    // Pilot2 deals most early, Pilot1 most late; both without logs so only output orders them.
    const entities = Object.fromEntries(Object.entries(tinyAnalysis.entities).map(([k, e]) => [k, { ...e, hasLog: false }]))
    const analysis = {
      ...tinyAnalysis, entities, interactions: [hit(T, 2, 900), hit(T + 1_000, 2, 900), hit(T + 50_000, 1, 500)],
      stats: tinyAnalysis.stats.map((s) => s.key === 'char:2' ? { ...s, damageOut: 1_800 } : s.key === 'char:1' ? { ...s, damageOut: 500 } : s),
    }
    mounted = mountApp(createElement('div', null, createElement(Roster), createElement(Probe)), { summary: tinySummary, analysis })
    expect(names().slice(0, 3)).toEqual(['Pilot2', 'Pilot1', 'Pilot3'])
    act(() => view.setRange([T + 40_000, T + 60_000]))
    expect(names().slice(0, 2)).toEqual(['Pilot1', 'Pilot2'])
    act(() => view.setRange(null))
    expect(names().slice(0, 2)).toEqual(['Pilot2', 'Pilot1'])
  })

  it('selects on click and clears on a second click', () => {
    let view!: ReturnType<typeof useView>
    function Probe() { view = useView(); return null }
    mounted = mountApp(createElement('div', null, createElement(Roster), createElement(Probe)))
    const main = () => row('Pilot2').querySelector<HTMLButtonElement>('.roster-main')!
    act(() => main().click())
    expect(view.selected).toBe('char:2')
    expect(row('Pilot2').hasAttribute('data-selected')).toBe(true)
    act(() => main().click())
    expect(view.selected).toBeNull()
  })

  it('moves a pilot from the row menu through api.putSide', async () => {
    const putSide = vi.spyOn(api, 'putSide').mockResolvedValue({ subject: 'char:2', side: 1, source: 'manual', setAt: 1 })
    mounted = mountApp(createElement(Roster))
    act(() => row('Pilot2').querySelector<HTMLButtonElement>('.roster-more')!.click())
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    expect(items.map((i) => i.textContent)).toEqual([
      '移到敌方', '移到我方', '移到敌方',
    ])
    const headings = [...document.querySelectorAll('.side-menu-head')].map((h) => h.textContent)
    expect(headings).toEqual(['移到… · Pilot2', '整个军团一起移 · Alpha Corp'])
    await act(async () => items[0]!.click())
    expect(putSide).toHaveBeenCalledWith('tiny', 'char:2', 1)
    // whole corporation, and whole alliance for a pilot that has one
    act(() => row('Pilot3').querySelector<HTMLButtonElement>('.roster-more')!.click())
    const alliance = [...document.querySelectorAll<HTMLElement>('[role="group"]')].find((g) => g.getAttribute('aria-label')?.startsWith('整个联盟'))!
    await act(async () => alliance.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
    expect(putSide).toHaveBeenLastCalledWith('tiny', 'ally:20', 0)
  })

  it('opens the same menu on right click and closes it with Escape', () => {
    mounted = mountApp(createElement(Roster))
    act(() => { row('Pilot1').dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 })) })
    expect(document.querySelector('[role="menu"]')).not.toBeNull()
    act(() => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[role="menu"]')).toBeNull()
  })

  it('shows the server message when a move fails', async () => {
    const { ApiFailure } = await import('../api/client')
    vi.spyOn(api, 'putSide').mockRejectedValue(new ApiFailure('bad_request', '无法移动', 400))
    mounted = mountApp(createElement(Roster))
    act(() => row('Pilot2').querySelector<HTMLButtonElement>('.roster-more')!.click())
    await act(async () => document.querySelector<HTMLButtonElement>('[role="menuitem"]')!.click())
    expect(mounted.container.querySelector('[role="alert"]')?.textContent).toBe('无法移动')
  })

  it('waits for the analysis instead of showing an empty list', () => {
    mounted = mountApp(createElement(Roster), { summary: tinySummary, analysis: null as never })
    expect(mounted.container.textContent).toContain('等待')
  })
})
