import {
  createContext, createElement, useContext, useEffect, useRef, useState, type ReactNode,
} from 'react'
import type { EntityKey } from '@/core/contract'

export type LayerId = 'dmgOurs' | 'dmgTheirs' | 'primary' | 'repOurs' | 'point' | 'kills' | 'killIcons'
export type FeedMode = 'merged' | 'raw' | 'key'
export type DrawerTab = 'stats' | 'fit' | 'events'
export type PanelTab = 'roster' | 'compare' | 'kills' | 'fit'
export type PlaybackSpeed = 1 | 2 | 4 | 8
export type TimeRange = readonly [from: number, to: number]

interface UrlView {
  oursSide: number | null
  t: number | null
  selected: EntityKey | null
}

interface ViewState {
  t: number
  playing: boolean
  speed: PlaybackSpeed
  range: TimeRange | null
  selected: EntityKey | null
  focusOnly: boolean
  oursSide: number
  layers: ReadonlySet<LayerId>
  feedMode: FeedMode
  drawerTab: DrawerTab
  panelTab: PanelTab
  seek(t: number): void
  play(): void
  pause(): void
  setSpeed(speed: PlaybackSpeed): void
  setRange(range: TimeRange | null): void
  select(key: EntityKey | null): void
  setFocusOnly(focus: boolean): void
  setOursSide(side: number): void
  toggleLayer(layer: LayerId): void
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
  return { oursSide: readInteger(params.get('ours')), t: readInteger(params.get('t')), selected: readSelection(params.get('sel')) }
}

const emptyUrlView: UrlView = { oursSide: null, t: null, selected: null }
const defaultLayers: LayerId[] = ['dmgOurs', 'dmgTheirs', 'primary', 'kills']
const ViewContext = createContext<ViewState | null>(null)

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
  const [urlView, setUrlView] = useState(() => syncUrl ? readView() : emptyUrlView)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<PlaybackSpeed>(1)
  const [range, saveRange] = useState<TimeRange | null>(null)
  const [focusOnly, setFocusOnly] = useState(false)
  const [layers, setLayers] = useState<ReadonlySet<LayerId>>(() => new Set(defaultLayers))
  const [feedMode, setFeedMode] = useState<FeedMode>('merged')
  const [drawerTab, setDrawerTab] = useState<DrawerTab>('stats')
  const [panelTab, setPanelTab] = useState<PanelTab>('roster')
  const lastUrlWrite = useRef(-Infinity)

  useEffect(() => {
    if (!syncUrl) return
    function restore() {
      setUrlView(readView())
      setFocusOnly(false)
      setPlaying(false)
    }
    window.addEventListener('popstate', restore)
    return () => window.removeEventListener('popstate', restore)
  }, [syncUrl])

  useEffect(() => {
    if (!syncUrl || (playing && performance.now() - lastUrlWrite.current < 1000)) return
    const url = new URL(window.location.href)
    const params = { ours: urlView.oursSide, t: urlView.t, sel: urlView.selected }
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
  }, [urlView, playing, syncUrl])

  const { selected } = urlView
  const t = urlView.t ?? initialTime

  useEffect(() => {
    if (!playing) return
    let last = performance.now()
    let frame: number
    function tick(now: number) {
      const increment = Math.max(0, now - last) * speed
      last = now
      setUrlView((previous) => {
        const next = (previous.t ?? initialTime) + increment
        return { ...previous, t: Math.min(next, endTime ?? Infinity) }
      })
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

  function select(key: EntityKey | null) {
    setUrlView((previous) => ({ ...previous, selected: previous.selected === key ? null : key }))
    setFocusOnly(false)
    setDrawerTab('stats')
  }

  const value: ViewState = {
    t,
    playing,
    speed,
    range,
    selected,
    focusOnly: selected !== null && focusOnly,
    oursSide: urlView.oursSide ?? defaultSide,
    layers,
    feedMode,
    drawerTab,
    panelTab,
    seek: (next) => {
      if (Number.isFinite(next)) setUrlView((previous) => ({ ...previous, t: Math.max(0, Math.round(next)) }))
    },
    play: () => {
      if (endTime !== undefined && t >= endTime) {
        setUrlView((previous) => ({ ...previous, t: initialTime }))
      }
      setPlaying(true)
    },
    pause: () => setPlaying(false),
    setSpeed,
    setRange: (next) => saveRange(next && (next[0] <= next[1] ? next : [next[1], next[0]])),
    select,
    setFocusOnly,
    setOursSide: (side) => {
      if (Number.isSafeInteger(side) && side >= 0) setUrlView((previous) => ({ ...previous, oursSide: side }))
    },
    toggleLayer: (layer) => setLayers((previous) => {
      const next = new Set(previous)
      if (next.has(layer)) next.delete(layer)
      else next.add(layer)
      return next
    }),
    setFeedMode,
    setDrawerTab,
    setPanelTab,
  }
  return createElement(ViewContext.Provider, { value }, children)
}

export function useView(): ViewState {
  const view = useContext(ViewContext)
  if (!view) throw new Error('useView requires ViewProvider')
  return view
}
