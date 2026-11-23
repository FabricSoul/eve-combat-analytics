// @vitest-environment jsdom
import { act, createElement, Fragment, Profiler } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, expect, it, vi } from 'vitest'
import { CompareTable } from '../battle/CompareTable'
import { BattleProvider } from './battle-store'
import { useCoarseTime, usePlayback, useView, ViewProvider } from './view-store'

afterEach(() => vi.unstubAllGlobals())

it('does not render stable view consumers or CompareTable as the playhead advances', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  let nextFrame: FrameRequestCallback
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    nextFrame = callback
    return 1
  })
  vi.stubGlobal('cancelAnimationFrame', vi.fn())
  const root = createRoot(document.createElement('div'))
  let view!: ReturnType<typeof useView>
  let renders = 0
  const coarseTimes: number[] = []
  const compareCommits = vi.fn()
  function ViewOnly() {
    view = useView()
    renders++
    return null
  }
  function CoarseOnly() {
    coarseTimes.push(useCoarseTime())
    return null
  }
  let playback!: ReturnType<typeof usePlayback>
  function PlaybackOnly() {
    playback = usePlayback()
    return null
  }

  try {
    act(() => root.render(createElement(ViewProvider, {
      syncUrl: false,
      initialTime: 1_000,
      children: createElement(Fragment, null,
        createElement(ViewOnly),
        createElement(CoarseOnly),
        createElement(PlaybackOnly),
        createElement(BattleProvider, {
          static: {
            summary: {
              meta: { brId: 'test', source: 'br.evetools', fetchedAt: 0, windows: [], teams: [[], []], killmails: [], names: {} },
              logs: [], fits: [], names: {}, sideOverrides: [], analysisVersion: 1,
            },
            analysis: {
              entities: {}, sideOverrides: [], interactions: [], ewarSpans: [], primaries: [], stats: [], coverage: [],
              timeline: { start: 0, damageBySide: {} },
            },
          },
          children: createElement(Profiler, {
            id: 'compare', onRender: compareCommits, children: createElement(CompareTable),
          }),
        }),
      ),
    })))

    act(() => view.play())
    const stableView = view
    const initialRenders = renders
    const initialCoarseRenders = coarseTimes.length
    compareCommits.mockClear()
    const start = performance.now()
    for (const elapsed of [16, 32, 48, 64, 256, 272]) act(() => nextFrame(start + elapsed))

    expect({ stableRenders: renders - initialRenders, compareCommits: compareCommits.mock.calls.length })
      .toEqual({ stableRenders: 0, compareCommits: 0 })
    expect(view).toBe(stableView)
    expect(coarseTimes.slice(initialCoarseRenders)).toEqual([1_250])
    expect(playback.t).toBeGreaterThan(1_250)
    expect(view.getTime()).toBe(playback.t)
    act(() => view.pause())
    expect(coarseTimes.at(-1)).toBe(playback.t)
    act(() => view.setRange([1_000, 2_000]))
    expect(compareCommits).toHaveBeenCalledTimes(1)
  } finally {
    act(() => root.unmount())
  }
})
