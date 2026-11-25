// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { prewarmFitEngine } from './client'
import { useFitPrewarm } from './use-fit-prewarm'

vi.mock('./client', () => ({ prewarmFitEngine: vi.fn().mockResolvedValue(undefined) }))

let root: Root
let viewport: { width: number; finePointer: boolean }
let idle: Map<number, IdleRequestCallback>
let connection: { saveData?: boolean; effectiveType?: string } | undefined

function Probe({ analysisRendered, drawerOpen }: { analysisRendered: boolean; drawerOpen: boolean }) {
  useFitPrewarm(analysisRendered, drawerOpen)
  return null
}

function render(analysisRendered: boolean, drawerOpen = false) {
  act(() => root.render(<Probe analysisRendered={analysisRendered} drawerOpen={drawerOpen} />))
}

function runIdle() {
  const callbacks = [...idle.values()]
  idle.clear()
  for (const callback of callbacks) callback({ didTimeout: false, timeRemaining: () => 50 })
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.mocked(prewarmFitEngine).mockClear()
  root = createRoot(document.createElement('div'))
  viewport = { width: 1100, finePointer: true }
  connection = undefined
  idle = new Map()
  let nextId = 0
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(min-width: 1100px) and (pointer: fine)' && viewport.width >= 1100 && viewport.finePointer,
  }))
  vi.stubGlobal('requestIdleCallback', (callback: IdleRequestCallback) => {
    const id = ++nextId
    idle.set(id, callback)
    return id
  })
  vi.stubGlobal('cancelIdleCallback', (id: number) => idle.delete(id))
  vi.stubGlobal('navigator', Object.create(navigator, { connection: { get: () => connection } }))
})

afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

it.each([undefined, { saveData: false, effectiveType: '4g' }])(
  'waits for analysis and then starts on desktop idle with connection %j', (quality) => {
    connection = quality
    render(false)
    expect(idle.size).toBe(0)
    render(true)
    expect(idle.size).toBe(1)
    render(true, true)
    expect(prewarmFitEngine).not.toHaveBeenCalled()
    runIdle()
    expect(prewarmFitEngine).toHaveBeenCalledTimes(1)
  },
)

it.each([
  { name: 'phone', width: 390, finePointer: false, quality: { effectiveType: '4g' } },
  { name: 'tablet with mouse', width: 1099, finePointer: true, quality: { effectiveType: '4g' } },
  { name: 'wide coarse pointer', width: 1280, finePointer: false, quality: { effectiveType: '4g' } },
  { name: 'Save-Data', width: 1280, finePointer: true, quality: { saveData: true, effectiveType: '4g' } },
  ...['slow-2g', '2g', '3g'].map((effectiveType) => ({
    name: effectiveType, width: 1280, finePointer: true, quality: { effectiveType },
  })),
])('waits for the pilot drawer on $name', ({ width, finePointer, quality }) => {
  viewport = { width, finePointer }
  connection = quality
  render(true)
  expect(idle.size).toBe(0)
  expect(prewarmFitEngine).not.toHaveBeenCalled()
  render(true, true)
  expect(prewarmFitEngine).toHaveBeenCalledTimes(1)
})

it('rechecks connection eligibility before queued idle work runs', () => {
  connection = { effectiveType: '4g' }
  render(true)
  expect(idle.size).toBe(1)
  connection = { effectiveType: '3g' }
  runIdle()
  expect(prewarmFitEngine).not.toHaveBeenCalled()
  render(true, true)
  expect(prewarmFitEngine).toHaveBeenCalledTimes(1)
})

it('retains the timer fallback on an eligible desktop', () => {
  vi.stubGlobal('requestIdleCallback', undefined)
  vi.useFakeTimers()
  render(true)
  vi.advanceTimersByTime(999)
  expect(prewarmFitEngine).not.toHaveBeenCalled()
  vi.advanceTimersByTime(1)
  expect(prewarmFitEngine).toHaveBeenCalledTimes(1)
})

it('does not start while a deep-linked drawer is still waiting for analysis', () => {
  viewport = { width: 390, finePointer: false }
  render(false, true)
  expect(prewarmFitEngine).not.toHaveBeenCalled()
  render(true, true)
  expect(prewarmFitEngine).toHaveBeenCalledTimes(1)
})
