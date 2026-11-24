// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import type { Analysis, BattleSummary, ServerMessage } from '@/core/contract'
import { useBattle } from './battle-store'

const battlePath = '/api/battles/test'
const initialSummary: BattleSummary = {
  meta: { brId: 'test', source: 'br.evetools', fetchedAt: 0, windows: [], teams: [[], []], killmails: [], names: {} },
  logs: [], fits: [], names: {}, sideOverrides: [], analysisVersion: 1,
}
const initialAnalysis: Analysis = {
  entities: {}, sideOverrides: [], interactions: [], ewarSpans: [], primaries: [], stats: [], coverage: [],
  timeline: { start: 0, damageBySide: {} },
}

let sockets: FakeSocket[]
let root: Root
let battle: ReturnType<typeof useBattle>
const fetcher = vi.fn<typeof fetch>()
const callsTo = (path: string) => fetcher.mock.calls.filter(([url]) => url === path).length

class FakeSocket extends EventTarget {
  constructor() {
    super()
    sockets.push(this)
  }
  open() {
    this.dispatchEvent(new Event('open'))
  }
  close() {
    this.dispatchEvent(new Event('close'))
  }
  message(message: ServerMessage) {
    this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) }))
  }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.stubGlobal('fetch', fetcher)
  fetcher.mockReset()
  sockets = []
  root = createRoot(document.createElement('div'))
})

afterEach(() => {
  act(() => root.unmount())
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

async function mount() {
  function Probe() {
    battle = useBattle('test')
    return null
  }
  await act(async () => root.render(createElement(Probe)))
}

const tick = async (ms: number) => act(async () => vi.advanceTimersByTimeAsync(ms))

it('exposes a disconnect and reconnects with the latest snapshot', async () => {
  fetcher.mockImplementation(async (url) => url === battlePath
    ? Response.json(initialSummary)
    : Response.json(initialAnalysis, { headers: { ETag: '"v1"' } }))
  await mount()
  act(() => sockets[0]!.open())
  expect(battle.live).toBe(true)
  act(() => sockets[0]!.close())
  expect(battle).toMatchObject({ live: false, reconnecting: true })
  await tick(999)
  expect(sockets).toHaveLength(1)
  await tick(1)
  expect(sockets).toHaveLength(2)
  const fit = { charId: 42, eft: '[Ship, Fit]', setAt: 1 }
  act(() => {
    sockets[1]!.open()
    sockets[1]!.message({ type: 'snapshot', state: { ...initialSummary, fits: [fit] } })
  })
  expect(battle).toMatchObject({ live: true, reconnecting: false, summary: { fits: [fit] } })
})

it('merges uploaded names by ID into the existing summary from log_added', async () => {
  const existing = { 1: { name: 'Existing character', category: 'character' } }
  const metaNames = { 1000165: { name: 'Hedion University', category: 'corporation' } }
  const summary = { ...initialSummary, meta: { ...initialSummary.meta, names: existing } }
  fetcher.mockImplementation(async (url) => url === battlePath ? Response.json(summary) : Response.json(initialAnalysis))
  await mount()
  const message = {
    type: 'log_added', log: { id: 'log', charId: 1, charName: 'Existing character', side: -1, events: 1, uploadedAt: 1 },
    names: {}, metaNames,
  } as const
  act(() => sockets[0]!.message(message))
  expect(battle.summary?.meta.names).toEqual({ ...existing, ...metaNames })
})

it('backs off repeated 503 analysis responses and clears the delay on success', async () => {
  const analysisPath = `${battlePath}/analysis`
  fetcher.mockImplementation(async (url) => {
    if (url === battlePath) return Response.json(initialSummary)
    const attempt = callsTo(analysisPath)
    if (attempt <= 3 || attempt === 5) return Response.json({ error: 'br_unavailable', message: 'pending' }, { status: 503 })
    return Response.json(initialAnalysis, { headers: { ETag: attempt === 4 ? '"v1"' : '"v2"' } })
  })
  await mount()
  expect(battle.analysis).toBeNull()
  expect(battle.error).toBeNull()
  await tick(2_000)
  expect(callsTo(analysisPath)).toBe(2)
  await tick(3_999)
  expect(callsTo(analysisPath)).toBe(2)
  await tick(1)
  expect(callsTo(analysisPath)).toBe(3)
  await tick(7_999)
  expect(callsTo(analysisPath)).toBe(3)
  await tick(1)
  expect(battle.analysis).toEqual(initialAnalysis)
  await act(async () => sockets[0]!.message({ type: 'analysis_ready', version: 2 }))
  expect(callsTo(analysisPath)).toBe(5)
  await tick(2_000)
  expect(callsTo(analysisPath)).toBe(6)
})

it('fetches a newly published version immediately during a pending retry', async () => {
  const analysisPath = `${battlePath}/analysis`
  fetcher.mockImplementation(async (url) => {
    if (url === battlePath) return Response.json({ ...initialSummary, analysisVersion: 0 })
    if (callsTo(analysisPath) === 1) return Response.json({ error: 'br_unavailable', message: 'pending' }, { status: 503 })
    return Response.json(initialAnalysis, { headers: { ETag: '"v1"' } })
  })
  await mount()
  await act(async () => sockets[0]!.message({ type: 'analysis_ready', version: 1 }))
  expect(callsTo(analysisPath)).toBe(2)
  expect(battle.analysis).toEqual(initialAnalysis)
  await tick(2_000)
  expect(callsTo(analysisPath)).toBe(2)
})

it('polls the summary every 15 seconds after three failed reconnects and stops when live returns', async () => {
  const pollSummary = { ...initialSummary, analysisVersion: 2 }
  const newAnalysis = { ...initialAnalysis, timeline: { start: 1, damageBySide: {} } }
  let finishPoll!: (response: Response) => void
  fetcher.mockImplementation(async (url) => {
    if (url === battlePath) {
      const reads = callsTo(battlePath)
      if (reads === 3) return new Promise<Response>((resolve) => { finishPoll = resolve })
      return Response.json(reads === 1 ? initialSummary : pollSummary)
    }
    const newer = callsTo(battlePath) > 1
    return Response.json(newer ? newAnalysis : initialAnalysis, { headers: { ETag: newer ? '"v2"' : '"v1"' } })
  })
  await mount()
  act(() => sockets[0]!.close())
  for (const [index, delay] of [1_000, 2_000, 4_000].entries()) {
    await tick(delay)
    expect(callsTo(battlePath)).toBe(1)
    await act(async () => sockets[index + 1]!.close())
  }
  expect(callsTo(battlePath)).toBe(2)
  expect(battle).toMatchObject({ analysis: newAnalysis, summary: pollSummary })
  await tick(8_000)
  act(() => sockets[4]!.close())
  await tick(6_999)
  expect(callsTo(battlePath)).toBe(2)
  await tick(1)
  expect(callsTo(battlePath)).toBe(3)
  await tick(8_000)
  const fit = { charId: 42, eft: '[Ship, Fit]', setAt: 2 }
  act(() => {
    sockets[5]!.open()
    sockets[5]!.message({ type: 'snapshot', state: { ...pollSummary, fits: [fit] } })
  })
  await act(async () => finishPoll(Response.json(pollSummary)))
  await tick(30_000)
  expect(battle).toMatchObject({ live: true, reconnecting: false, summary: { fits: [fit] } })
  expect(callsTo(battlePath)).toBe(3)
})

it('publishes an analyzed mutation snapshot only when the matching analysis arrives', async () => {
  let deliver!: (response: Response) => void
  fetcher.mockImplementation(async (url) => {
    if (url === battlePath) return Response.json(initialSummary)
    if (callsTo(`${battlePath}/analysis`) === 1) return Response.json(initialAnalysis, { headers: { ETag: '"v1"' } })
    return new Promise((resolve) => { deliver = resolve })
  })
  await mount()
  expect(battle.analyzedSummary).toEqual(initialSummary)
  const merges = [{ from: 'ship:10:0', to: 'char:42', setAt: 2 }] as const
  act(() => sockets[0]!.message({ type: 'identities_set', merges: [...merges] }))
  expect(battle.summary?.identityMerges).toEqual(merges)
  expect(battle.analyzedSummary?.identityMerges).toBeUndefined()
  await act(async () => sockets[0]!.message({ type: 'analysis_ready', version: 2 }))
  expect(battle.analyzedSummary?.analysisVersion).toBe(1)
  const overrides = [{ subject: 'char:42', side: 1, setAt: 3, source: 'manual' }] as const
  act(() => sockets[0]!.message({ type: 'sides_set', overrides: [...overrides] }))
  await act(async () => deliver(Response.json(initialAnalysis, { headers: { ETag: '"v2"' } })))
  expect(battle.analyzedSummary).toMatchObject({ analysisVersion: 2, identityMerges: merges, sideOverrides: [] })
  expect(battle.summary?.sideOverrides).toEqual(overrides)
})
