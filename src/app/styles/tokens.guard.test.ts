// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Analysis, BattleSummary, ServerMessage } from '@/core/contract'
import { tokenGroups } from '../gallery/TokensPage'
import { defaultOursSide, sideColor, sideLetter, sideOrder } from '../lib/sides'
import { useBattle } from '../state/battle-store'
import { useView, ViewProvider } from '../state/view-store'

const appDirectory = resolve('src/app')

function filesIn(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    return entry.isDirectory() ? filesIn(path) : [path]
  })
}

describe('design tokens', () => {
  it('lists every CSS token once and describes its use', () => {
    const css = readFileSync(resolve(appDirectory, 'styles/tokens.css'), 'utf8')
    const declared = [...new Set(Array.from(css.matchAll(/(--[\w-]+)\s*:/g), (match) => match[1]))]
    const listed = tokenGroups.flatMap(({ tokens }) => tokens.map(({ name }) => name))
    expect(listed.sort()).toEqual(declared.sort())
    expect(tokenGroups.every(({ tokens }) => tokens.every(({ use }) => use.trim()))).toBe(true)
  })

  it('keeps hexadecimal and RGB colors in tokens.css', () => {
    const colorLiteral = /(?<![\w-])#(?:[\da-f]{8}|[\da-f]{6}|[\da-f]{4}|[\da-f]{3})(?![\w-])|\brgba?\s*\(/i
    const violations = filesIn(appDirectory)
      .filter((path) => /\.(?:[cm]?[jt]sx?|css|html|json|svg)$/.test(path) && !path.endsWith('/styles/tokens.css'))
      .filter((path) => colorLiteral.test(readFileSync(path, 'utf8')))
    expect(violations).toEqual([])
  })
})

const summary: BattleSummary = {
  meta: { brId: 'test', source: 'br.evetools', fetchedAt: 0, windows: [], teams: [[], []], killmails: [], names: {} },
  logs: [], fits: [], names: {}, sideOverrides: [], analysisVersion: 1,
}
const analysis: Analysis = {
  entities: {}, sideOverrides: [], interactions: [], ewarSpans: [], primaries: [], stats: [], coverage: [],
  timeline: { start: 0, damageBySide: {} },
}

describe('side display', () => {
  it('starts with our side, then sorts opponents by population and breaks ties by side ID', () => {
    const coverage = [11, 7, 11, 4].map((known, side) => ({ side, known, withLog: 0 }))
    const order = sideOrder({ ...analysis, coverage }, 3)
    expect(order).toEqual([3, 0, 2, 1])
    expect(order.map((side) => sideColor(side, order))).toEqual([
      'var(--color-side-0)', 'var(--color-side-1)', 'var(--color-side-2)', 'var(--color-side-n)',
    ])
    expect(order.map((side) => sideLetter(side, order))).toEqual([null, null, null, 'D'])
    expect(sideColor(-1, order)).toBe('var(--color-side-n)')
    expect(sideLetter(-1, order)).toBeNull()
    expect(sideOrder({ ...analysis, coverage: coverage.slice(0, 2) }, 1)).toEqual([1, 0])
  })

  it('counts distinct assigned uploaders, including manual side changes', () => {
    const log = { id: 'a', charId: 1, charName: 'Pilot', side: 0, events: 0, uploadedAt: 0 }
    expect(defaultOursSide({
      ...summary,
      logs: [log, { ...log, id: 'b' }, { ...log, id: 'c', charId: 2, side: 1 }, { ...log, id: 'd', charId: 3, side: 1 }],
    })).toBe(1)
    expect(defaultOursSide({
      ...summary,
      logs: [log],
      sideOverrides: [{ subject: 'char:1', side: 1, source: 'manual', setAt: 1 }],
    })).toBe(1)
    expect(defaultOursSide(summary)).toBe(0)
  })
})

describe('browser stores', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.useRealTimers()
    window.history.replaceState(null, '', '/')
  })

  it('reads and writes ours, t and sel, preserving the rest of the URL', () => {
    window.history.replaceState(null, '', '/b/test?ours=1&t=1000&sel=char%3A42&x=keep#top')
    let view!: ReturnType<typeof useView>
    function Probe() {
      view = useView()
      return null
    }
    act(() => root.render(createElement(ViewProvider, { children: createElement(Probe) })))
    expect([view.oursSide, view.t, view.selected]).toEqual([1, 1000, 'char:42'])
    expect([...view.layers]).toEqual(['dmgOurs', 'dmgTheirs', 'primary', 'kills'])
    act(() => {
      view.setOursSide(3)
      view.seek(2500)
      view.select('name:飞行员 & 舰船')
    })
    const url = new URL(window.location.href)
    expect(Object.fromEntries(url.searchParams)).toEqual({ ours: '3', t: '2500', sel: 'name:飞行员 & 舰船', x: 'keep' })
    expect(url.hash).toBe('#top')
    act(() => {
      view.setFocusOnly(true)
      view.select(null)
    })
    expect(view.focusOnly).toBe(false)
    expect(new URLSearchParams(window.location.search).has('sel')).toBe(false)
    act(() => {
      window.history.replaceState(null, '', '/b/test?ours=2&t=500&sel=ship%3A43%3A-1')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    expect([view.oursSide, view.t, view.selected]).toEqual([2, 500, 'ship:43:-1'])
  })

  it('applies every WebSocket message and fetches new analysis with its previous ETag', async () => {
    let socket!: FakeSocket
    class FakeSocket extends EventTarget {
      close = vi.fn()
      constructor(readonly url: string) {
        super()
        socket = this
      }
      server(message: ServerMessage) {
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }))
      }
    }
    vi.stubGlobal('WebSocket', FakeSocket)
    const nextAnalysis = { ...analysis, timeline: { start: 3, damageBySide: {} } }
    const fetcher = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(summary))
      .mockResolvedValueOnce(Response.json(analysis, { headers: { ETag: '"v1"' } }))
      .mockResolvedValueOnce(Response.json(nextAnalysis, { headers: { ETag: '"v2"' } }))
    vi.stubGlobal('fetch', fetcher)
    let battle!: ReturnType<typeof useBattle>
    function Probe() {
      battle = useBattle('test')
      return null
    }
    await act(async () => root.render(createElement(Probe)))
    expect(socket.url).toMatch(/^ws:\/\/.*\/api\/battles\/test\/ws$/)
    expect(battle).toMatchObject({ status: 'ready', analysis, live: false })
    const log = { id: 'a', charId: 1, charName: 'Pilot', side: 0, events: 15, uploadedAt: 0 }
    const fit = { charId: 1, eft: '[Ship, Fit]', setAt: 100 }
    const override = { subject: 'char:1', side: 1, source: 'manual', setAt: 1 } as const
    const names = { Pilot: { charId: 1, side: 0 } }
    await act(async () => {
      socket.dispatchEvent(new Event('open'))
      socket.server({ type: 'snapshot', state: summary })
      socket.server({ type: 'log_added', log, names })
      socket.server({ type: 'log_added', log, names })
      socket.server({ type: 'fit_set', fit })
      socket.server({ type: 'sides_set', overrides: [override] })
      socket.server({ type: 'analysis_ready', version: 2 })
    })
    expect(battle).toMatchObject({ live: true, analysis: nextAnalysis })
    expect(battle.summary).toMatchObject({ logs: [log], fits: [fit], sideOverrides: [override], names, analysisVersion: 2 })
    expect(fetcher).toHaveBeenCalledTimes(3)
    const [url, init] = fetcher.mock.calls[2]!
    expect(url).toBe('/api/battles/test/analysis')
    expect(new Headers(init?.headers).get('If-None-Match')).toBe('"v1"')
  })
})
