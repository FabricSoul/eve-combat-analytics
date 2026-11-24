import {
  createContext, createElement, useCallback, useContext, useEffect, useLayoutEffect,
  useMemo, useRef, useState, type ReactNode,
} from 'react'
import type { EntityKey } from '@/core/contract'

export type LayerId = 'dmgOurs' | 'dmgTheirs' | 'primary' | 'repOurs' | 'point' | 'kills' | 'killIcons'
export type FeedMode = 'merged' | 'raw' | 'key'
/** Each event, not merged by kind (user decision 2026-11-24). */
export const defaultFeedMode: FeedMode = 'raw'
export const feedModeStorageKey = 'eca.feedMode'

/** The mode the user last chose on this device, else the default. */
export function readFeedMode(storage: Pick<Storage, 'getItem'> = window.localStorage): FeedMode {
  try {
    const value = storage.getItem(feedModeStorageKey)
    return value === 'merged' || value === 'raw' || value === 'key' ? value : defaultFeedMode
  } catch {
    return defaultFeedMode
  }
}

function writeFeedMode(mode: FeedMode, storage: Pick<Storage, 'setItem'> = window.localStorage) {
  try { storage.setItem(feedModeStorageKey, mode) } catch { /* A private window keeps the choice for this visit only. */ }
}
export type DrawerTab = 'stats' | 'fit' | 'events'
export type PanelTab = 'roster' | 'compare' | 'hits' | 'kills' | 'fit'
export type PlaybackSpeed = 1 | 2 | 4 | 8
export type TimeRange = readonly [from: number, to: number]

const replayNoiseFilters = ['drones', 'smartbombs', 'small', 'misses'] as const
export type ReplayNoiseFilter = typeof replayNoiseFilters[number]

export function writeReplayNoise(params: URLSearchParams, filters: ReadonlySet<ReplayNoiseFilter>) {
  const value = replayNoiseFilters.filter((filter) => filters.has(filter)).join(',')
  if (value) params.set('hide', value)
  else params.delete('hide')
}

interface UrlView {
  oursSide: number | null
  t: number | null
  selected: EntityKey | null
  hiddenNoise: ReadonlySet<ReplayNoiseFilter>
}

interface PlaybackState {
  t: number
  playing: boolean
}

interface TransportState {
  time: number | null
  range: TimeRange | null
}

type PilotModule = 'compare' | 'hits'

interface ViewState {
  speed: PlaybackSpeed
  range: TimeRange | null
  selected: EntityKey | null
  pinned: ReadonlySet<EntityKey>
  focusOnly: boolean
  oursSide: number
  layers: ReadonlySet<LayerId>
  hiddenNoise: ReadonlySet<ReplayNoiseFilter>
  feedMode: FeedMode
  drawerTab: DrawerTab
  panelTab: PanelTab
  includeUnidentified: ReadonlySet<PilotModule>
  getTime(): number
  seek(t: number): void
  play(): void
  pause(): void
  setSpeed(speed: PlaybackSpeed): void
  setRange(range: TimeRange | null): void
  clearRange(): void
  select(key: EntityKey | null): void
  setPinned(keys: ReadonlySet<EntityKey>): void
  togglePin(key: EntityKey): void
  setFocusOnly(focus: boolean): void
  setOursSide(side: number): void
  toggleLayer(layer: LayerId): void
  toggleNoiseFilter(filter: ReplayNoiseFilter): void
  setFeedMode(mode: FeedMode): void
  setDrawerTab(tab: DrawerTab): void
  setPanelTab(tab: PanelTab): void
  toggleUnidentified(module: PilotModule): void
}

function readInteger(value: string | null): number | null {
  if (value === null || !/^\d+$/.test(value)) return null
  const number = Number(value)
  return Number.isSafeInteger(number) ? number : null
}

function readSelection(value: string | null): EntityKey | null {
  return value && /^(?:char:\d+|ship:\d+:-?\d+|name:[\s\S]+)$/.test(value) ? value as EntityKey : null
}

function readView(): UrlView {
  const params = new URLSearchParams(window.location.search)
  const hidden = new Set(params.get('hide')?.split(','))
  return {
    oursSide: readInteger(params.get('ours')), t: readInteger(params.get('t')), selected: readSelection(params.get('sel')),
    hiddenNoise: new Set(replayNoiseFilters.filter((filter) => hidden.has(filter))),
  }
}

const emptyUrlView: UrlView = { oursSide: null, t: null, selected: null, hiddenNoise: new Set() }
const defaultLayers: LayerId[] = ['dmgOurs', 'dmgTheirs', 'primary', 'kills']
const ViewContext = createContext<ViewState | null>(null)
const PlaybackContext = createContext<PlaybackState | null>(null)
const CoarsePlaybackContext = createContext<PlaybackState | null>(null)
const coarseInterval = 250

interface ViewProviderProps {
  children: ReactNode
  initialTime?: number
  endTime?: number
  defaultSide?: number
  syncUrl?: boolean
}

export function ViewProvider({
  children, initialTime = 0, endTime, defaultSide = 0, syncUrl = true,
}: ViewProviderProps) {
  const [initialView] = useState(() => syncUrl ? readView() : emptyUrlView)
  const [{ time, range }, setTransport] = useState<TransportState>({ time: initialView.t, range: null })
  const [side, setSide] = useState(initialView.oursSide)
  const [selected, setSelected] = useState(initialView.selected)
  const [hiddenNoise, setHiddenNoise] = useState(initialView.hiddenNoise)
  const [pinned, setPinned] = useState<ReadonlySet<EntityKey>>(() => new Set())
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)
  const [focusOnly, setFocusOnly] = useState(false)
  const [layers, setLayers] = useState<ReadonlySet<LayerId>>(() => new Set(defaultLayers))
  const [feedMode, setFeedModeState] = useState<FeedMode>(() => syncUrl ? readFeedMode() : defaultFeedMode)
  const setFeedMode = useCallback((mode: FeedMode) => {
    setFeedModeState(mode)
    if (syncUrl) writeFeedMode(mode)
  }, [syncUrl])
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('stats')
  const [panelTab, setPanelTab] = useState<PanelTab>('roster')
  const [includeUnidentified, setIncludeUnidentified] = useState<ReadonlySet<PilotModule>>(() => new Set())
  const lastUrlWrite = useRef(-Infinity)
  const t = time ?? initialTime
  const currentTime = useRef(t)
  useLayoutEffect(() => { currentTime.current = t }, [t])

  useEffect(() => {
    if (!syncUrl) return
    function restore() {
      const view = readView()
      setTransport({ time: view.t, range: null })
      setSide(view.oursSide)
      setSelected(view.selected)
      setHiddenNoise(view.hiddenNoise)
      setFocusOnly(false)
      setPlaying(false)
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [syncUrl])

  useEffect(() => {
    if (!syncUrl) return
    const url = new URL(window.location.href)
    const oldNoise = url.searchParams.get('hide')
    writeReplayNoise(url.searchParams, hiddenNoise)
    if (oldNoise === url.searchParams.get('hide') && playing && performance.now() - lastUrlWrite.current < 1000) return
    const params = { ours: side, t: time, sel: selected }
    for (const [name, value] of Object.entries(params)) {
      const encoded = typeof value === 'number' ? String(Math.floor(value)) : value
      if (url.searchParams.get(name) === encoded) continue
      if (encoded === null) url.searchParams.delete(name)
      else url.searchParams.set(name, encoded)
    }
    if (url.href !== window.location.href) {
      lastUrlWrite.current = performance.now()
      try {
        window.history.replaceState(window.history.state, '', url)
      } catch {
        // Some browsers rate-limit history updates during rapid scrubbing.
      }
    }
  }, [side, time, selected, hiddenNoise, playing, syncUrl])

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let frame: number
    function tick(now: number) {
      const increment = Math.max(0, now - last) * speed
      last = now
      setTransport((previous) => ({
        ...previous,
        time: Math.min((previous.time ?? initialTime) + increment, previous.range?.[1] ?? endTime ?? Infinity),
      }))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [playing, speed, initialTime, endTime])

  const playEnd = range?.[1] ?? endTime
  useEffect(() => {
    if (playing && playEnd !== undefined && t >= playEnd) setPlaying(false)
  }, [t, playing, playEnd])

  const select = useCallback((key: EntityKey | null) => {
    setSelected((previous) => previous === key ? null : key)
    setFocusOnly(false)
    setDrawerTab('stats')
  }, [])

  const getTime = useCallback(() => currentTime.current, [])
  const seek = useCallback((next: number) => {
    if (!Number.isFinite(next)) return
    const rounded = Math.max(0, Math.round(next))
    setTransport((previous) => {
      const range = previous.range
      const time = range ? Math.max(range[0], Math.min(rounded, range[1])) : rounded
      return previous.time === time ? previous : { ...previous, time }
    })
  }, [])
  const play = useCallback(() => {
    setTransport((previous) => {
      const end = previous.range?.[1] ?? endTime
      if (end === undefined || (previous.time ?? initialTime) < end) return previous
      return { ...previous, time: previous.range?.[0] ?? initialTime }
    })
    setPlaying(true)
  }, [endTime, initialTime])
  const pause = useCallback(() => setPlaying(false), [])
  const clearRange = useCallback(() => {
    setTransport((previous) => previous.range ? { ...previous, range: null } : previous)
  }, [])
  const setRange = useCallback((next: TimeRange | null) => {
    if (!next) return clearRange()
    const from = Math.min(...next)
    const to = Math.max(...next)
    setTransport({ time: from, range: [from, to] })
    setPlaying(false)
  }, [clearRange])
  const setOursSide = useCallback((side: number) => {
    if (Number.isSafeInteger(side) && side >= 0) setSide(side)
  }, [])
  const toggleLayer = useCallback((layer: LayerId) => setLayers((previous) => {
    const next = new Set(previous)
    if (next.has(layer)) next.delete(layer)
    else next.add(layer)
    return next
  }), [])
  const toggleNoiseFilter = useCallback((filter: ReplayNoiseFilter) => setHiddenNoise((previous) => {
    const next = new Set(previous)
    if (next.has(filter)) next.delete(filter)
    else next.add(filter)
    return next
  }), [])
  const togglePin = useCallback((key: EntityKey) => setPinned((previous) => {
    const next = new Set(previous)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }), [])
  const toggleUnidentified = useCallback((module: PilotModule) => setIncludeUnidentified((previous) => {
    const next = new Set(previous)
    if (next.has(module)) next.delete(module)
    else next.add(module)
    return next
  }), [])
  const oursSide = side ?? defaultSide
  const focused = selected !== null && focusOnly
  const value = useMemo<ViewState>(() => ({
    speed,
    range,
    selected,
    pinned,
    focusOnly: focused,
    oursSide,
    layers,
    hiddenNoise,
    feedMode,
    drawerTab,
    panelTab,
    includeUnidentified,
    getTime,
    seek,
    play,
    pause,
    setSpeed,
    setRange,
    clearRange,
    select,
    setPinned,
    togglePin,
    setFocusOnly,
    setOursSide,
    toggleLayer,
    toggleNoiseFilter,
    setFeedMode,
    setDrawerTab,
    setPanelTab,
    toggleUnidentified,
  }), [speed, range, selected, pinned, focused, oursSide, layers, hiddenNoise, feedMode, drawerTab, panelTab, includeUnidentified,
    getTime, seek, play, pause, setRange, clearRange, select, togglePin, setOursSide, toggleLayer, toggleNoiseFilter, toggleUnidentified])
  const playback = useMemo(() => ({ t, playing }), [t, playing])
  const coarseTime = playing ? Math.max(range?.[0] ?? 0, Math.floor(t / coarseInterval) * coarseInterval) : t
  const coarsePlayback = useMemo(() => ({ t: coarseTime, playing }), [coarseTime, playing])
  return createElement(ViewContext.Provider, { value },
    createElement(PlaybackContext.Provider, { value: playback },
      createElement(CoarsePlaybackContext.Provider, { value: coarsePlayback }, children)))
}

export function useView(): ViewState {
  const view = useContext(ViewContext)
  if (!view) throw new Error('useView requires ViewProvider')
  return view
}

export function usePlayback(cadence: 'frame' | 'coarse' = 'frame'): PlaybackState {
  const playback = useContext(cadence === 'coarse' ? CoarsePlaybackContext : PlaybackContext)
  if (!playback) throw new Error('usePlayback requires ViewProvider')
  return playback
}

export function useCoarseTime(): number {
  return usePlayback('coarse').t
}
