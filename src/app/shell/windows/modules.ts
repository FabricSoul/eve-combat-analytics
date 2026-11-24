import { clampWindow, type Viewport, type WindowRect } from './layout'
import { defaultReplayOverlays, replayOverlayReducer, validReplayOverlays, type ReplayOverlayAction, type ReplayOverlayLayout } from './replay-layout'

export const moduleIds = ['feed', 'compare', 'roster', 'kills', 'hits', 'lanes'] as const
export type ModuleId = typeof moduleIds[number]
export const moduleTitles: Record<ModuleId, string> = {
  feed: '事件', compare: '对比', roster: '名单', kills: '击毁', hits: '命中', lanes: '按人时间线',
}
export const areaNames = ['a', 'b', 'c'] as const
export interface ModuleState { hidden: boolean; collapsed: boolean; floating: boolean; rect: WindowRect | null }
export interface ModuleLayout {
  areas: ModuleId[][]
  modules: Record<ModuleId, ModuleState>
  order: ModuleId[]
  stageHeight: number | null
  replay: ReplayOverlayLayout
}
type Drop = { type: 'move'; id: ModuleId; area: number; index: number }
export type ModuleAction = Drop
  | { type: 'toggle' | 'collapse' | 'dock' | 'focus'; id: ModuleId }
  | { type: 'float' | 'position'; id: ModuleId; rect: WindowRect }
  | { type: 'stage'; height: number | null }
  | { type: 'replay'; action: ReplayOverlayAction }
  | { type: 'reset' }
export const moduleStorageKey = 'eve-combat-analytics:module-layout'
const version = 5

export function defaultModules(): ModuleLayout {
  return {
    areas: [['feed', 'compare'], ['roster', 'kills'], ['hits', 'lanes']],
    modules: Object.fromEntries(moduleIds.map((id) => [id, { hidden: false, collapsed: false, floating: false, rect: null }])) as ModuleLayout['modules'],
    order: [...moduleIds],
    stageHeight: null,
    replay: defaultReplayOverlays(),
  }
}

export function visibleArea(layout: ModuleLayout, area: number, count: number) {
  return area === 1 && count === 2 ? [...layout.areas[1]!, ...layout.areas[2]!] : layout.areas[area]!
}

export function moduleLayoutReducer(layout: ModuleLayout, action: ModuleAction): ModuleLayout {
  if (action.type === 'reset') return defaultModules()
  if (action.type === 'stage') return { ...layout, stageHeight: action.height }
  if (action.type === 'replay') {
    const replay = replayOverlayReducer(layout.replay, action.action)
    return replay === layout.replay ? layout : { ...layout, replay }
  }
  const { id } = action
  if (action.type === 'move') {
    if (!layout.areas[action.area]) return layout
    const areas = layout.areas.map((area) => area.filter((candidate) => candidate !== id))
    areas[action.area]!.splice(Math.max(0, action.index), 0, id)
    return { ...layout, areas }
  }
  const state = layout.modules[id]
  const update = (patch: Partial<ModuleState>, raise = false) => ({
    ...layout,
    modules: { ...layout.modules, [id]: { ...state, ...patch } },
    order: raise ? [...layout.order.filter((item) => item !== id), id] : layout.order,
  })
  switch (action.type) {
    case 'toggle': return update({ hidden: !state.hidden }, state.hidden && state.floating)
    case 'collapse': return update({ collapsed: !state.collapsed })
    case 'dock': return update({ floating: false })
    case 'float': return update({ floating: true, rect: action.rect }, true)
    case 'position': return update({ rect: action.rect })
    case 'focus': return layout.order.at(-1) === id ? layout : update({}, true)
  }
}

export function keyboardDrop(layout: ModuleLayout, id: ModuleId, key: string, count: number): Drop | null {
  const source = layout.areas.findIndex((items) => items.includes(id))
  const displayed = Math.min(source, count - 1)
  const lane = visibleArea(layout, displayed, count)
  const index = lane.indexOf(id)
  const delta = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1
  if (key === 'ArrowLeft' || key === 'ArrowRight') {
    const area = displayed + delta
    return area >= 0 && area < count ? { type: 'move', id, area, index } : null
  }
  if (key !== 'ArrowUp' && key !== 'ArrowDown') return null
  const before = delta < 0 ? lane.slice(0, index).reverse() : lane.slice(index + 1)
  const other = before.find((candidate) => {
    const state = layout.modules[candidate]
    return !state.hidden && !state.floating
  })
  if (!other) return null
  const area = layout.areas.findIndex((items) => items.includes(other))
  const peers = layout.areas[area]!.filter((candidate) => candidate !== id)
  return { type: 'move', id, area, index: peers.indexOf(other) + (delta > 0 ? 1 : 0) }
}

export const timelineMinHeight = 150

export function replayHeightBounds(viewportHeight: number, workspaceHeight: number, timelineHeight: number) {
  const stageBorders = 2
  const stageGutter = 8
  const timeline = Math.max(timelineMinHeight, timelineHeight)
  const available = Math.max(0, Math.floor(workspaceHeight - timeline - stageBorders - stageGutter))
  const modules = Math.min(220, Math.max(0, available - 120))
  const max = available - modules
  const min = Math.min(220, max)
  const initial = Math.round(viewportHeight * 0.62) - timeline - stageBorders
  return { min, max, initial: Math.min(max, Math.max(min, initial)) }
}

export function clampStage(height: number, { min, max }: Pick<ReturnType<typeof replayHeightBounds>, 'min' | 'max'>) {
  return Math.round(Math.min(max, Math.max(min, height)))
}

export function floatModule(id: ModuleId, viewport: Viewport): WindowRect {
  const width = id === 'compare' || id === 'hits' ? 570 : 380
  return clampWindow({ x: (viewport.width - width) / 2, y: 64, width, height: 400 }, viewport)
}

const isObject = (x: unknown): x is Record<string, unknown> => Boolean(x && typeof x === 'object' && !Array.isArray(x))
const number = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const ids = (x: unknown): x is ModuleId[] => Array.isArray(x) && x.every((id) => moduleIds.includes(id))
const permutation = (x: unknown): x is ModuleId[] => ids(x) && x.length === moduleIds.length && new Set(x).size === moduleIds.length

function validModule(value: unknown): value is ModuleState {
  if (!isObject(value) || typeof value.hidden !== 'boolean'
    || typeof value.collapsed !== 'boolean' || typeof value.floating !== 'boolean') return false
  const rect = value.rect
  return rect === null ? !value.floating : isObject(rect)
    && number(rect.x) && rect.x >= 0 && number(rect.y) && rect.y >= 0
    && number(rect.width) && rect.width > 0 && number(rect.height) && rect.height > 0
}

export function loadModules(storage?: Pick<Storage, 'getItem'>): ModuleLayout {
  try {
    const value: unknown = JSON.parse((storage ?? localStorage).getItem(moduleStorageKey) ?? 'null')
    if (isObject(value) && (value.version === version || value.version === 4)) {
      const { areas, modules, order, stageHeight, replay } = value
      if (Array.isArray(areas) && areas.length === 3 && areas.every(ids) && permutation(areas.flat())
        && isObject(modules) && Object.keys(modules).length === moduleIds.length && moduleIds.every((id) => validModule(modules[id]))
        && permutation(order) && (stageHeight === null || (number(stageHeight) && stageHeight >= 0)) && validReplayOverlays(replay)) {
        // In v4 the saved height included the timeline. Preserve the rest of the layout.
        return { areas, modules: modules as ModuleLayout['modules'], order, stageHeight: value.version === 4 ? null : stageHeight, replay }
      }
    }
  } catch {
    // An invalid snapshot or unavailable storage uses the default.
  }
  return defaultModules()
}

export function saveModules(layout: ModuleLayout, storage?: Pick<Storage, 'setItem'>) {
  try {
    (storage ?? localStorage).setItem(moduleStorageKey, JSON.stringify({ ...layout, version }))
  } catch {
    // Layout changes remain available for the current page.
  }
}
