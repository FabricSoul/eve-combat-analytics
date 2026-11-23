// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BattleSummary } from '@/core/contract'
import { api } from '../api/client'
import { BattlePage } from '../battle/BattlePage'
import { buildRoster, type RosterRow } from '../battle/roster/model'
import { readRecent } from '../home/recent'
import { defaultOursSide } from '../lib/sides'
import { loadUiFixture } from '../test/ui-fixture'

vi.mock('../battle/ReplayCanvas', () => ({ ReplayCanvas: () => null }))
vi.mock('../battle/Timeline', async () => {
  const { usePlayback, useView } = await import('../state/view-store')
  return {
    Timeline: () => {
      const view = useView()
      const { t } = usePlayback()
      return <button type="button" onClick={() => view.setRange([t, t + 1000])}>
        {view.range ? '清除选段测试' : '建立选段测试'}
      </button>
    },
  }
})

const { summary: realSummary, analysis } = loadUiFixture()
const pilotName = 'Blanchard2213'
const brId = realSummary.meta.brId
const selection = Object.values(analysis.entities).find(({ name }) => name === pilotName)!
let host: HTMLDivElement
let root: Root
let socket: TestSocket
let tablet = false

class TestSocket extends EventTarget {
  constructor() {
    super()
    socket = this
  }
  close() {}
}

async function render(summary: BattleSummary = realSummary) {
  vi.spyOn(api, 'getBattle').mockResolvedValue(summary)
  vi.spyOn(api, 'getAnalysis').mockResolvedValue({ analysis, etag: '"v1"' })
  await act(async () => root.render(<BattlePage brId={brId} />))
}

function button(text: string, within: Element = host): HTMLButtonElement {
  const found = [...within.querySelectorAll<HTMLButtonElement>('button')]
    .find((node) => (node.getAttribute('aria-label') ?? node.textContent?.trim()) === text)
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}

function pilotButton() {
  const found = [...host.querySelectorAll<HTMLButtonElement>('.roster-main')]
    .find((node) => node.textContent?.includes(pilotName))
  if (!found) throw new Error(`Missing pilot: ${pilotName}`)
  return found
}

function click(node: HTMLElement) {
  act(() => { node.focus(); node.click() })
}

function escape() {
  act(() => { document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', bubbles: true, cancelable: true,
  })) })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('WebSocket', TestSocket)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: tablet && query.includes('760px <= width'),
    addEventListener() {}, removeEventListener() {},
  }))
  tablet = false
  history.replaceState(null, '', `/b/${brId}`)
  localStorage.clear()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})

afterEach(() => {
  act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('battle shell review', () => {
  it('I2: Escape closes sides before the top-bar menu, range and selection', async () => {
    await render()
    click(pilotButton())
    const sideOpener = button('排边')
    click(sideOpener)
    const sides = host.querySelector('[role="dialog"][aria-label="排边"]')
    expect(document.activeElement).toBe(sides)
    escape()
    expect(host.querySelector('[role="dialog"][aria-label="排边"]')).toBeNull()
    expect(host.querySelector('.battle-drawer')).not.toBeNull()
    expect(document.activeElement).toBe(sideOpener)

    click(button('建立选段测试'))
    const actions = button('更多战斗操作')
    click(actions)
    // A global Escape also needs to close the disclosure when focus is already elsewhere.
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true })) })
    expect(actions.getAttribute('aria-expanded')).toBe('false')
    expect(button('清除选段测试')).toBeTruthy()
    escape()
    expect(button('建立选段测试')).toBeTruthy()
    expect(host.querySelector('.battle-drawer')).not.toBeNull()
    escape()
    expect(host.querySelector('.battle-drawer')).toBeNull()
  })

  it('M3: shows a lost live connection in the top bar and clears it when the socket returns', async () => {
    await render()
    const header = host.querySelector('header.app-topbar')!
    act(() => { socket.dispatchEvent(new Event('open')) })
    expect(header.textContent).not.toMatch(/重连中…|离线/)
    const lost = socket
    act(() => { lost.dispatchEvent(new Event('close')) })
    expect(header.querySelector('[role="status"]')?.textContent).toMatch(/重连中…|离线/)
    // A late event on the closed socket must not clear the status; only the reconnect's new socket does.
    act(() => { lost.dispatchEvent(new Event('open')) })
    expect(header.querySelector('[role="status"]')?.textContent).toMatch(/重连中…|离线/)
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 1100)) })
    expect(socket).not.toBe(lost)
    act(() => { socket.dispatchEvent(new Event('open')) })
    expect(header.textContent).not.toMatch(/重连中…|离线/)
  })

  it('M5: a roster rail button announces the named ship and destruction state', async () => {
    tablet = true
    const at = realSummary.meta.killmails.at(-1)!.t
    history.replaceState(null, '', `/b/${brId}?t=${at}`)
    const expected = buildRoster(realSummary, analysis, defaultOursSide(realSummary), at)
      .flatMap(({ rows }) => rows).find((row): row is RosterRow & { ship: string } => row.dead && row.ship !== null)!
    await render()
    const row = [...host.querySelectorAll('.battle-rail-pilot')]
      .find((node) => node.getAttribute('aria-label')?.startsWith(`${expected.name} · `))
    expect(row?.getAttribute('aria-label')).toBe(
      `${expected.name} · ${expected.hasLog ? '有日志' : '没有日志'} · 已击毁 · ${expected.ship}`,
    )
  })

  it('M5: focuses the desktop drawer and restores the roster button on close', async () => {
    await render()
    const opener = pilotButton()
    click(opener)
    const drawer = host.querySelector('.battle-drawer')!
    expect(drawer.contains(document.activeElement)).toBe(true)
    click(button('关闭个人详情', drawer))
    expect(document.activeElement).toBe(opener)
  })

  it('M8: the side fit tab routes a selected pilot to one editor in the drawer', async () => {
    await render()
    click(button('配装'))
    const select = host.querySelector('.battle-panel')!.querySelector('select')!
    act(() => {
      select.focus()
      select.value = selection.key
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    const drawer = host.querySelector('.battle-drawer')!
    expect(host.querySelectorAll('textarea')).toHaveLength(1)
    expect(drawer.querySelector('textarea')).not.toBeNull()
    click(button('数据', drawer))
    click(button('在个人详情中编辑配装'))
    expect(host.querySelectorAll('textarea')).toHaveLength(1)
    expect(drawer.querySelector('textarea')).not.toBeNull()
  })

  it('M9: the header and recent entry share the unique system count', async () => {
    const first = realSummary.meta.windows[0]!
    // Synthetic second system and repeated window to exercise distinct system names.
    await render({ ...realSummary, meta: { ...realSummary.meta, windows: [
      first, { ...first, systemId: first.systemId + 1, systemName: 'Second System' }, first,
    ] } })
    const name = `${first.systemName} 等 2 个星系`
    expect(host.querySelector('.app-topbar-full-title')?.textContent).toContain(name)
    expect(readRecent()[0]?.title).toBe(name)
  })

  it('N5: a low battle value has one ISK label', async () => {
    const kill = realSummary.meta.killmails[0]!
    // Synthetic total below 10,000 ISK exercises the unscaled formatter.
    await render({ ...realSummary, meta: { ...realSummary.meta, killmails: [{ ...kill, value: 9000 }] } })
    expect(host.querySelector('.app-topbar-meta .app-topbar-isk')?.textContent?.trim()).toBe('· 9,000 ISK')
  })

  it('N6: the roster rules put secondary actions in the overflow or context menu', () => {
    const design = readFileSync('DESIGN.md', 'utf8')
    const rosterRule = design.split('\n').find((line) => line.startsWith('- **Roster and portraits**'))
    expect(rosterRule).toContain('Use one row button for the pilot. Put secondary actions in the ⋯ or context menu.')
  })
})
