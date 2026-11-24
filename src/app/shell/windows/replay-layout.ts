import type { WindowAction, WindowRect } from './layout'

export const replayOverlayIds = ['legend', 'fights'] as const
export type ReplayOverlayId = typeof replayOverlayIds[number]
export type ReplayOverlayAction = WindowAction<ReplayOverlayId> | { type: 'collapse'; id: ReplayOverlayId; collapsed: boolean }

interface ReplayOverlayState {
  open: boolean
  collapsed: boolean | null
  rect: WindowRect | null
}

export interface ReplayOverlayLayout {
  overlays: Record<ReplayOverlayId, ReplayOverlayState>
  order: ReplayOverlayId[]
}

export function defaultReplayOverlays(): ReplayOverlayLayout {
  return {
    overlays: { legend: { open: false, collapsed: false, rect: null }, fights: { open: true, collapsed: null, rect: null } },
    order: [...replayOverlayIds],
  }
}

export function replayOverlayReducer(layout: ReplayOverlayLayout, action: ReplayOverlayAction): ReplayOverlayLayout {
  if (action.type === 'reset') return defaultReplayOverlays()
  const { id } = action
  const state = layout.overlays[id]
  const update = (patch: Partial<ReplayOverlayState>): ReplayOverlayLayout => ({
    ...layout, overlays: { ...layout.overlays, [id]: { ...state, ...patch } },
  })
  const raise = (next: ReplayOverlayLayout) => next.order.at(-1) === id ? next
    : { ...next, order: [...next.order.filter((entry) => entry !== id), id] }
  switch (action.type) {
    case 'dock': return update({ open: false })
    case 'toggle': return state.open ? update({ open: false }) : raise(update({ open: true }))
    case 'show':
    case 'pop': return raise(update({ open: true }))
    case 'focus': return raise(layout)
    case 'minimize': return update({ collapsed: !state.collapsed })
    case 'collapse': return update({ collapsed: action.collapsed })
    case 'position': return update({ rect: action.rect })
  }
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function coordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function validReplayOverlays(value: unknown): value is ReplayOverlayLayout {
  if (!record(value)) return false
  const { order, overlays } = value
  if (!Array.isArray(order) || order.length !== replayOverlayIds.length
    || !replayOverlayIds.every((id) => order.includes(id)) || !record(overlays)) return false
  return replayOverlayIds.every((id) => {
    const state = overlays[id]
    if (!record(state) || typeof state.open !== 'boolean'
      || (typeof state.collapsed !== 'boolean' && state.collapsed !== null)) return false
    const { rect } = state
    return rect === null || (record(rect) && coordinate(rect.x) && coordinate(rect.y)
      && coordinate(rect.width) && rect.width > 0 && coordinate(rect.height) && rect.height > 0)
  })
}
