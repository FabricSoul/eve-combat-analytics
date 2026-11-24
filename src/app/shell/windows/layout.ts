import type { PanelTab } from '../../state/view-store'

export const windowIds = ['roster', 'feed', 'timeline', 'compare', 'hits', 'kills', 'fit'] as const
export type WindowId = typeof windowIds[number]
export type DockEdge = 'left' | 'right' | 'bottom'
export interface Viewport { width: number; height: number }
export interface WindowRect extends Viewport { x: number; y: number }

export interface WindowState {
  floating: boolean
  hidden: boolean
  minimized: boolean
  rect: WindowRect | null
}

export interface WindowLayout {
  windows: Record<WindowId, WindowState>
  activePanel: PanelTab
  order: WindowId[]
}

export type WindowAction<Id extends string = WindowId> =
  | { type: 'pop'; id: Id; viewport: Viewport }
  | { type: 'position'; id: Id; rect: WindowRect }
  | { type: 'dock' | 'minimize' | 'focus' | 'toggle' | 'show'; id: Id }
  | { type: 'reset' }

export const windowTitles: Record<WindowId, string> = {
  roster: '名单', feed: '事件', timeline: '时间轴', compare: '对比', hits: '命中', kills: '击毁', fit: '配装',
}

export const windowHeight = 34
export const windowStorageKey = 'eve-combat-analytics:window-layout'
export const windowDragClass = 'battle-window-dragging'
// v2 adds the 命中 window; v1 layouts fall back to the default.
const storageVersion = 2

export function isPanel(id: WindowId): id is PanelTab {
  return id !== 'feed' && id !== 'timeline'
}

export function defaultWindowLayout(): WindowLayout {
  const windows = Object.fromEntries(windowIds.map((id) =>
    [id, { floating: false, hidden: false, minimized: false, rect: null }])) as WindowLayout['windows']
  return { windows, activePanel: 'roster', order: [...windowIds] }
}

export function windowVisible(layout: WindowLayout, id: WindowId): boolean {
  const { floating, hidden } = layout.windows[id]
  return !hidden && (floating || !isPanel(id) || layout.activePanel === id)
}

export function clampWindow(rect: WindowRect, viewport: Viewport, minimized = false): WindowRect {
  const width = Math.min(viewport.width, Math.max(220, rect.width))
  const height = Math.min(viewport.height, Math.max(120, rect.height))
  const effectiveHeight = minimized ? Math.min(viewport.height, windowHeight) : height
  return {
    x: Math.min(viewport.width - width, Math.max(0, rect.x)),
    y: Math.min(viewport.height - effectiveHeight, Math.max(0, rect.y)),
    width, height,
  }
}

const sizes: Record<WindowId, Viewport> = {
  roster: { width: 320, height: 460 },
  feed: { width: 380, height: 420 },
  timeline: { width: 720, height: 230 },
  compare: { width: 570, height: 400 },
  hits: { width: 620, height: 460 },
  kills: { width: 360, height: 420 },
  fit: { width: 420, height: 420 },
}

function initialRect(id: WindowId, viewport: Viewport): WindowRect {
  const size = sizes[id]
  const center = (viewport.width - size.width) / 2
  return {
    ...size,
    x: id === 'feed' ? viewport.width - size.width - 56 : id === 'roster' ? 56 : center,
    y: id === 'timeline' ? viewport.height - size.height - 56 : 64,
  }
}

export function dockTarget(id: string, point: Pick<WindowRect, 'x' | 'y'>, viewport: Viewport): DockEdge | null {
  const { x, y } = point
  if (x < 0 || x > viewport.width || y < 0 || y > viewport.height) return null
  const margin = 24
  if (id === 'timeline') return viewport.height - y < margin ? 'bottom' : null
  if (id === 'feed') return viewport.width - x < margin ? 'right' : null
  return x < margin ? 'left' : null
}

export function windowLayoutReducer(layout: WindowLayout, action: WindowAction): WindowLayout {
  if (action.type === 'reset') return defaultWindowLayout()
  const { id } = action
  const window = layout.windows[id]
  const update = (patch: Partial<WindowState>) => ({
    ...layout, windows: { ...layout.windows, [id]: { ...window, ...patch } },
  })
  const raise = (next: WindowLayout) => next.order.at(-1) === id
    ? next : { ...next, order: [...next.order.filter((item) => item !== id), id] }

  switch (action.type) {
    case 'pop':
      return raise(update({ floating: true, hidden: false, minimized: false,
        rect: clampWindow(window.rect ?? initialRect(id, action.viewport), action.viewport) }))
    case 'dock': {
      const next = update({ floating: false, hidden: false })
      return isPanel(id) ? { ...next, activePanel: id } : next
    }
    case 'minimize': return update({ minimized: !window.minimized })
    case 'position': return update({ rect: action.rect })
    case 'focus': return raise(layout)
    case 'toggle':
      if (windowVisible(layout, id)) return update({ hidden: true })
      break
    case 'show':
      break
  }

  const next = update({ hidden: false })
  if (window.floating) return raise(next)
  return isPanel(id) ? { ...next, activePanel: id } : next
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function knownWindow(value: unknown): value is WindowId {
  return windowIds.some((id) => id === value)
}

function storedWindow(value: unknown): value is WindowState {
  if (!record(value) || typeof value.floating !== 'boolean' || typeof value.hidden !== 'boolean'
    || typeof value.minimized !== 'boolean') return false
  const { rect } = value
  if (rect === null) return !value.floating
  return record(rect) && ['x', 'y', 'width', 'height'].every((key) =>
    typeof rect[key] === 'number' && Number.isFinite(rect[key]) && rect[key] >= 0)
    && Number(rect.width) > 0 && Number(rect.height) > 0
}

export function loadWindowLayout(storage?: Pick<Storage, 'getItem'>): WindowLayout {
  try {
    const json = (storage ?? window.localStorage).getItem(windowStorageKey)
    if (json) {
      const raw: unknown = JSON.parse(json)
      if (record(raw) && raw.version === storageVersion) {
        const { windows, activePanel, order } = raw
        if (record(windows) && Object.keys(windows).length === windowIds.length
          && windowIds.every((id) => storedWindow(windows[id]))
          && knownWindow(activePanel) && isPanel(activePanel)
          && Array.isArray(order) && order.length === windowIds.length && order.every(knownWindow)
          && new Set(order).size === windowIds.length) {
          return { windows: windows as WindowLayout['windows'], activePanel, order }
        }
      }
    }
  } catch {
    // Browser storage can be disabled or stop working between page loads.
  }
  return defaultWindowLayout()
}

export function saveWindowLayout(layout: WindowLayout, storage?: Pick<Storage, 'setItem'>): void {
  try {
    (storage ?? window.localStorage).setItem(windowStorageKey, JSON.stringify({ version: storageVersion, ...layout }))
  } catch {
    // The current workspace still works with storage turned off.
  }
}
