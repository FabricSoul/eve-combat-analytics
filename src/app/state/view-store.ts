import {
  createContext, createElement, useCallback, useContext, useEffect, useLayoutEffect,
  useMemo, useRef, useState, type ReactNode,
} from 'react'
import type { EntityKey } from '@/core/contract'

export type LayerId = 'dmgOurs' | 'dmgTheirs' | 'primary' | 'repOurs' | 'point' | 'kills' | 'killIcons'
export type FeedMode = 'merged' | 'raw' | 'key'
export type DrawerTab = 'stats' | 'fit' | 'events'
export type PanelTab = 'roster' | 'compare' | 'kills' | 'fit'
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
  getTime(): number
  seek(t: number): void
  play(): void
  pause(): void
  setSpeed(speed: PlaybackSpeed): void
  setRange(range: TimeRange | null): void
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
  const [time, setTime] = useState(initialView.t)
  const [side, setSide] = useState(initialView.oursSide)
  const [selected, setSelected] = useState(initialView.selected)
  const [hiddenNoise, setHiddenNoise] = useState(initialView.hiddenNoise)
  const [pinned, setPinned] = useState<ReadonlySet<EntityKey>>(() => new Set())
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)
  const [range, saveRange] = useState<TimeRange | null>(null)
  const [focusOnly, setFocusOnly] = useState(false)
  const [layers, setLayers] = useState<ReadonlySet<LayerId>>(() => new Set(defaultLayers))
  const [feedMode, setFeedMode] = useState<FeedMode>('merged')
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('stats')
  const [panelTab, setPanelTab] = useState<PanelTab>('roster')
  const lastUrlWrite = useRef(-Infinity)
  const t = time ?? initialTime
  const currentTime = useRef(t)
  useLayoutEffect(() => { currentTime.current = t }, [t])

  useEffect(() => {
    if (!syncUrl) return
    function restore() {
      const view = readView()
      setTime(view.t)
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
      setTime((previous) => Math.min((previous ?? initialTime) + increment, endTime ?? Infinity))
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(frame)
    }
  }, [playing, speed, initialTime, endTime])

  useEffect(() => {
    if (playing && endTime !== undefined && t >= endTime) setPlaying(false)
  }, [t, playing, endTime])

  const select = useCallback((key: EntityKey | null) => {
    setSelected((previous) => previous === key ? null : key)
    setFocusOnly(false)
    setDrawerTab('stats')
  }, [])

  const getTime = useCallback(() => currentTime.current, [])
  const seek = useCallback((next: number) => {
    if (Number.isFinite(next)) setTime(Math.max(0, Math.round(next)))
  }, [])
  const play = useCallback(() => {
    if (endTime !== undefined && getTime() >= endTime) setTime(initialTime)
    setPlaying(true)
  }, [endTime, initialTime, getTime])
  const pause = useCallback(() => setPlaying(false), [])
  const setRange = useCallback((next: TimeRange | null) => {
    saveRange(next && (next[0] <= next[1] ? next : [next[1], next[0]]))
  }, [])
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
    getTime,
    seek,
    play,
    pause,
    setSpeed,
    setRange,
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
  }), [speed, range, selected, pinned, focused, oursSide, layers, hiddenNoise, feedMode, drawerTab, panelTab,
    getTime, seek, play, pause, setRange, select, togglePin, setOursSide, toggleLayer, toggleNoiseFilter])
  const playback = useMemo(() => ({ t, playing }), [t, playing])
  const coarseTime = playing ? Math.floor(t / coarseInterval) * coarseInterval : t
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
