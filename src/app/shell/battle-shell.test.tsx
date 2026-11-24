// @vitest-environment jsdom
import { readFileSync } from 'node:fs'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { BattleSummary } from '@/core/contract'
import { api } from '../api/client'
import { BattlePage } from '../battle/BattlePage'
import { readRecent } from '../home/recent'
import { loadUiFixture } from '../test/ui-fixture'

vi.mock('../battle/ReplayCanvas', () => ({ ReplayCanvas: () => null }))
vi.mock('../battle/Timeline', async () => {
  const { usePlayback, useView } = await import('../state/view-store')
  return {
    PilotTimelineModule: () => null,
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

async function render(summary: BattleSummary = realSummary, data = analysis) {
  vi.spyOn(api, 'getBattle').mockResolvedValue(summary)
  vi.spyOn(api, 'getAnalysis').mockResolvedValue({ analysis: data, etag: '"v1"' })
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
    expect(button('清除选段测试')).toBeTruthy()
    expect(host.querySelector('.battle-drawer')).toBeNull()
    expect(pilotButton().getAttribute('aria-pressed')).toBe('false')
    escape()
    expect(button('建立选段测试')).toBeTruthy()
  }, 12000)

  it('labels the layout menu and restores the default layout with a confirmation', async () => {
    await render()
    const menu = host.querySelector<HTMLDetailsElement>('.battle-module-controls')!
    const opener = menu.querySelector('summary')!
    expect(opener.textContent).toContain('布局')
    expect(opener.querySelector('svg')).not.toBeNull()
    menu.open = true
    click(button('恢复默认布局'))
    expect(menu.open).toBe(false)
    expect(document.activeElement).toBe(opener)
    expect(host.textContent).toContain('已恢复默认布局')
  })

  it('shows SVG module tools and describes the stage grip', async () => {
    await render()
    for (const name of ['搜索事件', '筛选事件', '弹出 名单', '收起 名单', '整页查看命中', '命中排名指标', '对比列']) {
      const control = button(name)
      expect(control.querySelector('svg')).not.toBeNull()
      expect(control.title).toBeTruthy()
    }
    expect(host.querySelector('[role="separator"]')?.getAttribute('title')).toBe('拖动调整高度，双击恢复')
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

  it('uses two module columns on tablet with the same roster selection', async () => {
    tablet = true
    await render()
    expect(host.querySelectorAll('[data-module-area]')).toHaveLength(2)
    expect(host.querySelectorAll('[data-module]')).toHaveLength(6)
    click(pilotButton())
    expect(pilotButton().getAttribute('aria-pressed')).toBe('true')
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

  it('provides one fit editor in the selected pilot drawer', async () => {
    await render()
    click(pilotButton())
    const drawer = host.querySelector('.battle-drawer')!
    expect(host.querySelector('[data-module="fit"]')).toBeNull()
    click(button('配装', drawer))
    expect(host.querySelectorAll('textarea')).toHaveLength(1)
    expect(drawer.querySelector('textarea')).not.toBeNull()
  })

  it('keeps a module’s active controls when a keyboard move changes its area', async () => {
    await render()
    const module = () => host.querySelector('[data-module="hits"]')!
    const select = () => module().querySelector('select')!
    const metric = select().options[1]!.value
    act(() => {
      select().value = metric
      select().dispatchEvent(new Event('change', { bubbles: true }))
    })
    const bar = module().querySelector<HTMLElement>('.battle-window-titlebar')!
    act(() => bar.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', altKey: true, bubbles: true, cancelable: true })))
    expect(module().closest('[data-module-area]')?.getAttribute('data-module-area')).toBe('1')
    expect(select().value).toBe(metric)
  })

  it('explains how to populate every empty module', async () => {
    await render(
      { ...realSummary, meta: { ...realSummary.meta, killmails: [] }, logs: [], fits: [], names: {} },
      { ...analysis, entities: {}, interactions: [], ewarSpans: [], stats: [], coverage: [], primaries: [] },
    )
    for (const [id, instruction] of [
      ['feed', '移动时间轴或调整筛选条件'],
      ['compare', '调整阵营或时间选段'],
      ['roster', '上传飞行员的日志'],
      ['kills', '导入含击毁报告的战斗链接'],
      ['hits', '调整选段或上传更多战斗日志'],
    ]) {
      expect(host.querySelector(`[data-module="${id}"]`)?.textContent).toContain(instruction)
    }
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
