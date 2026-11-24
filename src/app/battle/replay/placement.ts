import type { Point } from './layout-effects'

interface Size { width: number; height: number }
export interface Rect extends Point, Size {}

const gap = 2

function overlaps(a: Rect, b: Rect) {
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

export function placeReplayPopover(anchor: Rect, size: Size, bounds: Rect, gap: number): Rect {
  const width = Math.min(size.width, bounds.width)
  const belowY = anchor.y + anchor.height + gap
  const aboveBottom = anchor.y - gap
  const belowSpace = Math.max(0, bounds.y + bounds.height - belowY)
  const aboveSpace = Math.max(0, aboveBottom - bounds.y)
  const below = size.height <= belowSpace || belowSpace >= aboveSpace
  const height = Math.min(size.height, below ? belowSpace : aboveSpace)
  const rightmost = bounds.x + bounds.width - width
  const x = Math.max(bounds.x, Math.min(anchor.x, rightmost))
  const y = below ? belowY : aboveBottom - height
  return { x, y, width, height }
}

function findPilotLabelSpace(center: Point, size: Size, bounds: Rect, occupied: readonly Rect[]): Rect | null {
  const maxX = bounds.x + bounds.width - size.width
  const maxY = bounds.y + bounds.height - size.height
  if (maxX < bounds.x || maxY < bounds.y) return null
  const preferredX = center.x - size.width / 2
  const preferredY = center.y - size.height / 2
  const rows = [Math.max(bounds.y, Math.min(preferredY, maxY)), bounds.y, maxY]
  for (const rect of occupied) {
    rows.push(rect.y - size.height - gap, rect.y + rect.height + gap)
  }
  const obstacles = [...occupied].sort((a, b) => a.x - b.x)
  for (const y of [...new Set(rows)].sort((a, b) => Math.abs(a - preferredY) - Math.abs(b - preferredY))) {
    if (y < bounds.y || y > maxY) continue
    let left = bounds.x
    let bestX: number | null = null
    let bestDistance = Infinity
    const consider = (right: number) => {
      if (left > right) return
      const x = Math.max(left, Math.min(preferredX, right))
      const distance = Math.abs(x - preferredX)
      if (distance < bestDistance) {
        bestX = x
        bestDistance = distance
      }
    }
    for (const rect of obstacles) {
      if (y >= rect.y + rect.height + gap || y + size.height + gap <= rect.y) continue
      consider(Math.min(maxX, rect.x - gap - size.width))
      left = Math.max(left, rect.x + rect.width + gap)
      if (left > maxX) break
    }
    consider(maxX)
    if (bestX !== null) return { ...size, x: bestX, y }
  }
  return null
}

export function placePilotLabel(center: Point, radius: number, size: Size, bounds: Rect, occupied: readonly Rect[], required = false) {
  const { x, y } = center
  const gap = radius + 5
  const left = x - size.width / 2
  const top = y - size.height / 2
  const nearby = [
    { ...size, x: left, y: y + gap },
    { ...size, x: left, y: y - gap - size.height },
    { ...size, x: x + gap, y: top },
    { ...size, x: x - gap - size.width, y: top },
  ]
  const closest = placeAnnotation(nearby, bounds, occupied)
  if (closest || !required) return closest

  const farther: Rect[] = []
  const spacing = size.height + 4
  for (let step = 1; step <= 4; step++) {
    const distance = step * spacing
    for (const direction of [-1, 1]) {
      farther.push(
        { ...nearby[0]!, x: left + direction * distance },
        { ...nearby[1]!, x: left + direction * distance },
        { ...nearby[2]!, y: top + direction * distance },
        { ...nearby[3]!, y: top + direction * distance },
      )
    }
  }
  return placeAnnotation(farther, bounds, occupied) ?? findPilotLabelSpace(center, size, bounds, occupied)
}
