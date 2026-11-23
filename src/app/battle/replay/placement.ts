import type { Point } from './layout-effects'

interface Size { width: number; height: number }
export interface Rect extends Point, Size {}

function overlaps(a: Rect, b: Rect) {
  const gap = 2
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
}

function fits(rect: Rect, bounds: Rect) {
  return rect.x >= bounds.x && rect.y >= bounds.y
    && rect.x + rect.width <= bounds.x + bounds.width
    && rect.y + rect.height <= bounds.y + bounds.height
}

export function placeAnnotation(candidates: readonly Rect[], bounds: Rect, occupied: readonly Rect[], required = false): Rect | null {
  const preferred = candidates.find((rect) => fits(rect, bounds) && !occupied.some((other) => overlaps(rect, other)))
  if (preferred || !required) return preferred ?? null
  const fallback = candidates.find((rect) => fits(rect, bounds)) ?? candidates[0]
  return fallback ? {
    ...fallback,
    x: Math.max(bounds.x, Math.min(fallback.x, bounds.x + bounds.width - fallback.width)),
    y: Math.max(bounds.y, Math.min(fallback.y, bounds.y + bounds.height - fallback.height)),
  } : null
}

export function placePilotLabel(center: Point, radius: number, size: Size, bounds: Rect, occupied: readonly Rect[], required = false) {
  const { x, y } = center
  const gap = radius + 5
  const left = x - size.width / 2
  const top = y - size.height / 2
  return placeAnnotation([
    { ...size, x: left, y: y + gap },
    { ...size, x: left, y: y - gap - size.height },
    { ...size, x: x + gap, y: top },
    { ...size, x: x - gap - size.width, y: top },
  ], bounds, occupied, required)
}
