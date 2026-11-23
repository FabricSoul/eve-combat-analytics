// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Analysis, Entity, EntityKey, Interaction, Killmail } from '@/core/contract'
import { ReplayStage } from './ReplayStage'
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
