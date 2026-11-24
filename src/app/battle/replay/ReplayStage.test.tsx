// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Analysis, Entity, EntityKey, HitQuality, Interaction, Killmail } from '@/core/contract'
import { ReplayStage } from './ReplayStage'
import { ReplayCanvas } from '../ReplayCanvas'
import { EventFeed } from '../EventFeed'
import { hitSegments } from '../compare/hit-quality'
import { BattleProvider } from '@/app/state/battle-store'
import { ViewProvider } from '@/app/state/view-store'
import { loadUiFixture } from '@/app/test/ui-fixture'

const order = [0, 1]
const killmails = [] as const
const time = 10_000
const alpha: Entity = { key: 'char:1', side: 0, sideSource: 'br', name: 'Alpha', charId: 1, hasLog: true, shipTypes: [] }
const beta: Entity = { ...alpha, key: 'char:2', side: 1, name: 'Beta', charId: 2, hasLog: false }
const neutral: Entity = { ...beta, key: 'char:3', side: -1, name: 'Neutral', charId: 3 }
const newcomer: Entity = { ...beta, key: 'char:4', name: 'Newcomer', charId: 4 }

function observation(to: EntityKey): Interaction {
  return {
    t: time, from: alpha.key, to, kind: 'damage', amount: 100, weapon: null, quality: null,
    repairType: null, ewar: null, sources: [], corroborated: false,
  }
}

function analysis(pilots: Entity[] = [alpha, beta, neutral], interactions = pilots.map(({ key }) => observation(key))): Analysis {
  return {
    entities: Object.fromEntries(pilots.map((pilot) => [pilot.key, pilot])),
    interactions, coverage: [], sideOverrides: [], ewarSpans: [], primaries: [], stats: [],
    timeline: { start: time, damageBySide: {} },
  }
}

let host: HTMLDivElement
let root: Root
let frames: Map<number, FrameRequestCallback>
let nextFrame: number
const select = vi.fn()

async function refresh() {
  await act(() => {
    const scheduled = [...frames.values()]
    frames.clear()
    for (const callback of scheduled) callback(performance.now())
  })
}

async function render(
  result: Analysis, t = time, selected: EntityKey | null = null,
  battle: { killmails: readonly Killmail[]; order: readonly number[] } = { killmails, order },
) {
  await act(() => root.render(
    <ReplayStage analysis={result} killmails={battle.killmails} order={battle.order} t={t} playing={false}
      selected={selected} focusOnly={false} select={select} />,
  ))
  await refresh()
}

function button(name: string) {
  return host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
}

const marker = (name: string) => button(name).parentElement!

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  frames = new Map()
  nextFrame = 0
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextFrame, callback)
    return nextFrame
  })
  vi.stubGlobal('cancelAnimationFrame', (id: number) => { frames.delete(id) })
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(600)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(500)
  const noOp = () => {}
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
    setTransform: noOp, clearRect: noOp, setLineDash: noOp, beginPath: noOp,
    stroke: noOp, fill: noOp, moveTo: noOp, lineTo: noOp, arc: noOp,
    strokeText: noOp, fillText: noOp, measureText: () => ({ width: 38 }),
  }) as unknown as CanvasRenderingContext2D)
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  select.mockClear()
})

afterEach(async () => {
  await act(() => root.unmount())
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

it('shows every graded hit and the miss in game order with the comparison labels', async () => {
  const counts = {
    Wrecks: 1, Smashes: 1, Penetrates: 1, Hits: 1, 'Glances Off': 1, Grazes: 1,
  } satisfies Record<Exclude<HitQuality, 'none'>, number>
  const expected = ['致命一击', '强力一击', '穿透', '命中', '擦过', '轻轻擦过', '未命中']
  const comparison = hitSegments({ hitQuality: counts, misses: 1 })

  await render(analysis())
  const key = host.querySelector<HTMLDetailsElement>('.replay-key')!
  await act(() => key.querySelector('summary')!.click())
  expect(key.open).toBe(true)
  const entries = key.querySelector('.replay-key-quality')!.nextElementSibling!
  const labels = [...entries.querySelectorAll(':scope > div > span')].map((label) => label.textContent)

  expect(comparison.map(({ label }) => label)).toEqual(expected)
  expect(labels).toEqual(comparison.map(({ label }) => label))
  expect(entries.querySelectorAll('canvas')).toHaveLength(expected.length)
})

describe('replay analysis refresh', () => {
  it('preserves ship positions by key when refreshed analysis adds and reorders entities', async () => {
    await render(analysis())
    const names = [alpha.name, beta.name, neutral.name]
    const positions = names.map((name) => marker(name).style.transform)
    expect(positions.every(Boolean)).toBe(true)

    await render(analysis([newcomer, neutral, beta, alpha]))
    expect(names.map((name) => marker(name).style.transform)).toEqual(positions)
    expect(marker(newcomer.name).hasAttribute('data-present')).toBe(true)
    expect(marker(newcomer.name).style.transform).toBeTruthy()
  })
})

describe('replay keyboard navigation', () => {
  const tabStops = () => [...host.querySelectorAll<HTMLButtonElement>('.replay-pilot')]
    .filter((pilot) => pilot.tabIndex === 0)

  async function press(key: string) {
    await act(() => document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', {
      key, bubbles: true, cancelable: true,
    })))
    await refresh()
  }

  function expectBracketAt(name: string) {
    function xy(element: HTMLElement) {
      return element.style.transform.match(/translate3d\(([^,]+), ([^,]+)/)!.slice(1).map(parseFloat)
    }
    const bracket = host.querySelector<HTMLElement>('.replay-lock[data-positioned]')!
    const [x, y] = xy(marker(name))
    const [left, top] = xy(bracket)
    const inset = parseFloat(bracket.style.getPropertyValue('--replay-lock-size')) / 2
    expect(left! + inset).toBeCloseTo(x!)
    expect(top! + inset).toBeCloseTo(y!)
  }

  it('offers one tab stop, moves the bracket with focus, and selects with Enter', async () => {
    const initial = analysis()
    await render(initial)
    expect(tabStops()).toEqual([button(alpha.name)])
    expect(host.querySelector('[role="toolbar"]')?.getAttribute('aria-label')).toBeTruthy()

    await act(() => button(alpha.name).focus())
    await refresh()
    expectBracketAt(alpha.name)
    await press('ArrowRight')
    expect(document.activeElement).toBe(button(beta.name))
    expect(tabStops()).toEqual([button(beta.name)])
    expectBracketAt(beta.name)
    expect(select).not.toHaveBeenCalled()

    await press('Enter')
    expect(select).toHaveBeenCalledExactlyOnceWith(beta.key)
    await render(initial, time, beta.key)
    await press('ArrowDown')
    expect(document.activeElement).toBe(button(neutral.name))
    expectBracketAt(neutral.name)
    expect(host.querySelector('[aria-pressed="true"]')).toBe(button(beta.name))
  })

  it('keeps the pointer tooltip available while the bracket follows focus', async () => {
    await render(analysis())
    await act(() => button(alpha.name).focus())
    await act(() => button(beta.name).dispatchEvent(new PointerEvent('pointerover', { bubbles: true })))
    await refresh()
    expect(host.querySelector('[role="tooltip"] strong')?.textContent).toBe(beta.name)
    expectBracketAt(alpha.name)
  })

  it('moves focus to a present pilot when playback hides the focused ship', async () => {
    const initial = analysis()
    await render(initial)
    await act(() => button(beta.name).focus())
    await render(initial, time + 60_001)
    await refresh()
    expect(document.activeElement).toBe(button(alpha.name))
    expect(tabStops()).toEqual([button(alpha.name)])
    expectBracketAt(alpha.name)
  })
})


it('positions every present uploader label in the 1280 × 800 desktop canvas', async () => {
  const fixture = loadUiFixture()
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
  // The desktop shell takes 620 × 221 pixels for its side panels, top bar and timeline.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(660)
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(579)
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return Math.min(94, (this.textContent?.length ?? 0) * 6)
  })
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(16)
  await render(fixture.analysis, Date.UTC(2025, 5, 22, 15, 43, 2), null, { killmails: fixture.summary.meta.killmails, order: [1, 0] })
  const uploaders = [...host.querySelectorAll('.replay-marker[data-present] [data-log="true"]')]
  expect(uploaders).toHaveLength(17)
  expect(uploaders.filter((pilot) => !pilot.parentElement?.querySelector('.replay-pilot-label[data-positioned]'))
    .map((pilot) => pilot.getAttribute('aria-label'))).toEqual([])
})

it('keeps paused nodes still and keeps them still during quiet playback', async () => {
  vi.mocked(window.matchMedia).mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() } as unknown as MediaQueryList)
  const result = analysis()
  const positions = () => [alpha, beta, neutral].map(({ name }) => marker(name).style.transform)
  const quiet = time + 20_000
  await render(result, quiet)
  const initial = positions()
  for (let frame = 0; frame < 8; frame++) await refresh()
  expect(positions()).toEqual(initial)
  for (let offset = 0; offset < 2000; offset += 250) {
    await act(() => root.render(<ReplayStage analysis={result} killmails={killmails} order={order}
      t={quiet + offset} playing selected={null} select={select} focusOnly={false} />))
    await refresh()
    expect(positions()).toEqual(initial)
  }
})

it('shares URL-backed drone, smartbomb, small-hit and miss filters between the canvas and feed', async () => {
  const originalUrl = window.location.href
  window.history.replaceState(null, '', '?hide=drones')
  const { summary } = loadUiFixture()
  const enemies = ['Drone', 'Smartbomb', 'Small', 'Miss', 'Normal'].map((name, index): Entity => ({
    ...beta, name, key: `char:${index + 10}`, charId: index + 10,
  }))
  const weapons = ['Warrior II', '联邦海军大型等离子立体炸弹*', 'small gun', 'miss gun', 'main gun']
  const result = analysis([alpha, ...enemies], enemies.map(({ key }, index) => ({
    ...observation(key), kind: index === 3 ? 'miss' : 'damage', weapon: weapons[index]!,
    amount: index === 2 ? 99 : index === 3 ? 0 : 1000,
  })))
  const canvasHas = (name: string) => marker(name).hasAttribute('data-present')
  const feedHas = (weapon: string) => Boolean(host.querySelector(`.feed-weapon[title="${weapon}"]`))
  try {
    await act(() => root.render(
      <BattleProvider static={{ summary, analysis: result }}><ViewProvider initialTime={time}>
        <ReplayCanvas /><EventFeed />
      </ViewProvider></BattleProvider>,
    ))
    await act(async () => { await vi.dynamicImportSettled() })
    await refresh()
    const toggle = async (label: string) => {
      const input = [...host.querySelectorAll('label')].find((item) => item.textContent === label)?.querySelector('input')
      expect(input).toBeInstanceOf(HTMLInputElement)
      await act(() => input!.click())
      await refresh()
    }
    const check = (visible: boolean[]) => {
      expect(enemies.map(({ name }) => canvasHas(name))).toEqual(visible)
      expect(weapons.map(feedHas)).toEqual(visible)
    }
    check([false, true, true, true, true])
    await toggle('隐藏立体炸弹伤害')
    await toggle('隐藏小额伤害（低于 100）')
    await toggle('隐藏未命中')
    check([false, false, false, false, true])
    expect(new URLSearchParams(window.location.search).get('hide')).toBe('drones,smartbombs,small,misses')
    await toggle('隐藏无人机/战斗机伤害')
    check([true, false, false, false, true])
  } finally {
    window.history.replaceState(null, '', originalUrl)
  }
})

it('pans a zoomed touch drag that starts on a ship and keeps a tap selectable', async () => {
  await render(analysis())
  const stage = host.querySelector<HTMLDivElement>('.replay-stage')!
  Object.assign(stage, { setPointerCapture: vi.fn(), hasPointerCapture: () => false })
  const target = button(alpha.name)
  const zoom = host.querySelector<HTMLButtonElement>('[aria-label="放大"]')!
  await act(() => zoom.click())
  await refresh()
  const coordinates = () => marker(alpha.name).style.transform.match(/translate3d\(([^,]+), ([^,]+)/)!.slice(1).map(parseFloat)
  const before = coordinates()

  function touch(type: string, x: number, y: number, element = target) {
    const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true })
    Object.defineProperties(event, { pointerType: { value: 'touch' }, pointerId: { value: 5 } })
    element.dispatchEvent(event)
  }

  await act(() => {
    touch('pointerdown', 100, 100)
    touch('pointermove', 130, 120)
    touch('pointerup', 130, 120)
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  })
  await refresh()
  const [x, y] = coordinates()
  expect(x).toBeCloseTo(before[0]! + 30, 3)
  expect(y).toBeCloseTo(before[1]! + 20, 3)
  expect(select).not.toHaveBeenCalled()

  await act(() => {
    touch('pointerdown', 130, 120)
    touch('pointerup', 130, 120)
    target.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  })
  expect(select).toHaveBeenCalledExactlyOnceWith(alpha.key)

  // Touch drags can finish without a synthetic click. The next control tap still works.
  const fit = [...stage.querySelectorAll('button')].find((button) => button.textContent === '适应全部')!
  await act(() => {
    touch('pointerdown', 130, 120)
    touch('pointermove', 146, 140)
    touch('pointerup', 146, 140)
    touch('pointerdown', 10, 10, fit)
    touch('pointerup', 10, 10, fit)
    fit.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  })
  await refresh()
  expect(stage.hasAttribute('data-zoomed')).toBe(false)
})
