// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BattleSummary } from '@/core/contract'
import { api } from '../api/client'
import { SidesPanel } from './SidesPanel'
import { mountApp, tinyAnalysis, tinySummary } from './roster/testing'

let mounted: ReturnType<typeof mountApp>
let putSide: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  putSide = vi.spyOn(api, 'putSide').mockResolvedValue({ subject: 'char:1', side: 0, source: 'manual', setAt: 1 })
})
afterEach(() => { mounted?.unmount(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

const column = (side: string) => mounted.container.querySelector<HTMLElement>(`.sides-col[data-side="${side}"]`)!
const group = (side: string, subject: string) => column(side).querySelector<HTMLElement>(`.sides-row[data-subject="${subject}"]`)!
const fire = (el: Element, type: string) => act(() => { el.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })) })

describe('SidesPanel', () => {
  it('draws one column per side, 未分边 when someone has none, and 新建一方', () => {
    mounted = mountApp(createElement(SidesPanel))
    expect([...mounted.container.querySelectorAll('.sides-col-head')].map((h) => h.firstElementChild?.nextSibling?.textContent))
      .toEqual(['我方', '敌方', '未分边', '新建一方'])
    expect(mounted.container.querySelector('.sides-notice')?.textContent).toBe('还有 1 人未分边')
  })

  it('has no notice and no 未分边 column when everyone has a side', () => {
    const entities = { ...tinyAnalysis.entities }
    delete entities['char:6']
    mounted = mountApp(createElement(SidesPanel), { summary: tinySummary, analysis: { ...tinyAnalysis, entities } })
    expect(mounted.container.querySelector('.sides-notice')).toBeNull()
    expect(mounted.container.querySelector('.sides-col[data-side="-1"]')).toBeNull()
  })

  it('lists alliances and corporations with their logos and expands to pilots with portraits', () => {
    mounted = mountApp(createElement(SidesPanel))
    expect(group('0', 'corp:10').querySelector('img')?.getAttribute('src')).toContain('/corporations/10/logo')
    expect(group('0', 'ally:20').querySelector('img')?.getAttribute('src')).toContain('/alliances/20/logo')
    expect(group('0', 'corp:10').textContent).toContain('2 人')
    expect(column('0').querySelectorAll('.sides-pilot')).toHaveLength(0)
    act(() => group('0', 'corp:10').querySelector<HTMLButtonElement>('.sides-name button')!.click())
    const pilots = [...column('0').querySelectorAll('.sides-pilot')]
    expect(pilots.map((p) => p.textContent)).toEqual([expect.stringContaining('Pilot1'), expect.stringContaining('Pilot2')])
    expect(pilots[0]?.querySelector('img')?.getAttribute('src')).toContain('/characters/1/portrait')
  })

  it('dropping a group on another column puts that subject on that side', async () => {
    mounted = mountApp(createElement(SidesPanel))
    fire(group('0', 'corp:10'), 'dragstart')
    fire(column('1'), 'dragover')
    await act(async () => { column('1').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })) })
    expect(putSide).toHaveBeenCalledWith('tiny', 'corp:10', 1)
  })

  it('dropping a pilot moves the character; dropping on 新建一方 makes a new side', async () => {
    mounted = mountApp(createElement(SidesPanel))
    act(() => group('0', 'corp:10').querySelector<HTMLButtonElement>('.sides-name button')!.click())
    const pilot = column('0').querySelector<HTMLElement>('.sides-pilot[data-subject="char:2"]')!
    fire(pilot, 'dragstart')
    await act(async () => { column('new').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })) })
    expect(putSide).toHaveBeenCalledWith('tiny', 'char:2', 'new')
  })

  it('ignores a drop on the column an individual is already in', async () => {
    mounted = mountApp(createElement(SidesPanel))
    act(() => group('0', 'corp:10').querySelector<HTMLButtonElement>('.sides-name button')!.click())
    fire(group('0', 'char:2'), 'dragstart')
    await act(async () => { column('0').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })) })
    expect(putSide).not.toHaveBeenCalled()
  })

  it('keeps the drag when another tab changes the sides in the middle of it', async () => {
    mounted = mountApp(createElement(SidesPanel))
    fire(group('0', 'corp:10'), 'dragstart')
    mounted.rerender(createElement(SidesPanel), {
      summary: { ...tinySummary, sideOverrides: [{ subject: 'char:6', side: 1, source: 'manual', setAt: 5 }] },
      analysis: { ...tinyAnalysis, entities: { ...tinyAnalysis.entities, 'char:6': { ...tinyAnalysis.entities['char:6']!, side: 1, sideSource: 'manual' } } },
    })
    expect(mounted.container.querySelector('.sides-notice')).toBeNull()
    expect(group('0', 'corp:10').hasAttribute('data-dragging')).toBe(true)
    await act(async () => { column('1').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })) })
    expect(putSide).toHaveBeenCalledWith('tiny', 'corp:10', 1)
  })

  it('uses the committed side targets while analysis is stale and disables creation at eight sides', async () => {
    const summary: BattleSummary = {
      ...tinySummary, sideOverrides: [{ subject: 'char:6', side: 2, source: 'manual', setAt: 2 }],
    }
    mounted = mountApp(createElement(SidesPanel), { summary, analysis: tinyAnalysis })
    expect(column('2')).not.toBeNull()
    expect(column('2').textContent).toContain('Pilot6')
    fire(group('0', 'corp:10'), 'dragstart')
    await act(async () => { column('new').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })) })
    expect(putSide).toHaveBeenCalledWith('tiny', 'corp:10', 'new')

    putSide.mockClear()
    const stale = { ...tinyAnalysis, coverage: [...tinyAnalysis.coverage, { side: 2, known: 1, withLog: 0 }] }
    mounted.rerender(createElement(SidesPanel), { summary: tinySummary, analysis: stale })
    expect(column('2')).toBeNull()
    const atLimit: BattleSummary = {
      ...tinySummary, sideOverrides: [{ subject: 'char:6', side: 7, source: 'manual', setAt: 3 }],
    }
    mounted.rerender(createElement(SidesPanel), { summary: atLimit, analysis: tinyAnalysis })
    expect(column('new').getAttribute('aria-disabled')).toBe('true')
    fire(group('0', 'corp:10'), 'dragstart')
    fire(column('new'), 'dragover')
    expect(column('new').hasAttribute('data-drop')).toBe(false)
    await act(async () => { column('new').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })) })
    expect(putSide).not.toHaveBeenCalled()
    act(() => group('0', 'corp:10').querySelector<HTMLButtonElement>('.sides-more')!.click())
    expect(document.querySelector('[role="menu"]')?.textContent).not.toContain('移到新建的一方')
  })

  it('offers the nested corporation and labels cross-side organization moves with their full scope', async () => {
    mounted = mountApp(createElement(SidesPanel))
    const alliance = group('0', 'ally:20')
    expect(alliance.textContent).toContain('全联盟 · 2 人')
    act(() => alliance.querySelector<HTMLButtonElement>('.sides-name button')!.click())
    const corp = group('0', 'corp:11')
    expect(corp.textContent).toContain('全军团 · 2 人')
    expect(corp.querySelector('img')?.getAttribute('src')).toContain('/corporations/11/logo')
    fire(corp, 'dragstart')
    await act(async () => { column('1').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })) })
    expect(putSide).toHaveBeenCalledWith('tiny', 'corp:11', 1)
  })

  it('keeps 未分边 read-only for drops and provides a keyboard-focusable per-subject removal', async () => {
    const summary: BattleSummary = {
      ...tinySummary, sideOverrides: [{ subject: 'corp:10', side: 0, source: 'manual', setAt: 2 }],
    }
    mounted = mountApp(createElement(SidesPanel), { summary, analysis: tinyAnalysis })
    fire(group('0', 'corp:10'), 'dragstart')
    fire(column('-1'), 'dragover')
    expect(column('-1').hasAttribute('data-drop')).toBe(false)
    await act(async () => { column('-1').dispatchEvent(new Event('drop', { bubbles: true, cancelable: true })) })
    expect(putSide).not.toHaveBeenCalled()

    const remove = group('0', 'corp:10').querySelector<HTMLButtonElement>('button[aria-label="Alpha Corp：移除手动排边"]')!
    expect(remove.tabIndex).toBe(0)
    remove.focus()
    expect(document.activeElement).toBe(remove)
    await act(async () => remove.click())
    expect(putSide).toHaveBeenCalledWith('tiny', 'corp:10', -1)
  })

  it('focuses the dialog when opened and restores focus to its opener when closed', () => {
    function Harness() {
      const [open, setOpen] = useState(false)
      return <>
        <button onClick={() => setOpen(true)}>打开排边</button>
        {open && <SidesPanel onClose={() => setOpen(false)} />}
      </>
    }
    mounted = mountApp(createElement(Harness))
    const opener = mounted.container.querySelector('button')!
    opener.focus()
    act(() => opener.click())
    expect(document.activeElement).toBe(mounted.container.querySelector('[role="dialog"]'))
    expect(mounted.container.querySelector('[role="dialog"]')?.getAttribute('aria-modal')).toBe('true')
    const done = [...mounted.container.querySelectorAll('button')].find((button) => button.textContent === '完成')!
    act(() => done.click())
    expect(document.activeElement).toBe(opener)
  })

  it('offers the keyboard alternative in a ⋯ menu', async () => {
    mounted = mountApp(createElement(SidesPanel))
    act(() => group('0', 'corp:10').querySelector<HTMLButtonElement>('.sides-more')!.click())
    const items = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    expect(items.map((i) => i.textContent)).toEqual(['移到我方', '移到敌方', '移到新建的一方'])
    await act(async () => items[1]!.click())
    expect(putSide).toHaveBeenCalledWith('tiny', 'corp:10', 1)

    act(() => group('0', 'corp:10').querySelector<HTMLButtonElement>('.sides-more')!.click())
    const create = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].at(-1)!
    await act(async () => create.click())
    expect(putSide).toHaveBeenLastCalledWith('tiny', 'corp:10', 'new')
  })

  it('恢复 BR 的划分 removes every manual override', async () => {
    const summary: BattleSummary = {
      ...tinySummary,
      sideOverrides: [
        { subject: 'char:5', side: 1, source: 'manual', setAt: 1 },
        { subject: 'corp:10', side: 0, source: 'manual', setAt: 2 },
      ],
    }
    mounted = mountApp(createElement(SidesPanel), { summary, analysis: tinyAnalysis })
    const restore = [...mounted.container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === '恢复 BR 的划分')!
    await act(async () => restore.click())
    expect(putSide.mock.calls).toEqual([['tiny', 'char:5', -1], ['tiny', 'corp:10', -1]])
  })

  it('disables 恢复 when nothing was changed by hand, and 完成 calls onClose', () => {
    const onClose = vi.fn()
    mounted = mountApp(createElement(SidesPanel, { onClose }))
    const button = (label: string) => [...mounted.container.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent === label)!
    expect(button('恢复 BR 的划分').disabled).toBe(true)
    act(() => button('完成').click())
    expect(onClose).toHaveBeenCalled()
  })
})
