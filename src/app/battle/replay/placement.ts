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

export function placeFightsWindow(stage: Rect, topRight: number, belowPills: number, size: Size, pilots: readonly Rect[]): Rect {
  const width = Math.max(0, Math.min(size.width, stage.width - 24))
  const left = stage.x + 12
  const right = stage.x + stage.width - width - 12
  const bottom = Math.max(stage.y, stage.y + stage.height - size.height - 8)
  const boundedY = (y: number) => Math.max(stage.y, Math.min(bottom, y))
  const candidates = [
    { x: right, y: boundedY(topRight) },
    { x: right, y: bottom },
    { x: left, y: boundedY(belowPills) },
  ]
  let best = { ...candidates[0]!, ...size, width }
  let fewest = Infinity
  for (const candidate of candidates) {
    const rect = { ...candidate, ...size, width }
    const covered = pilots.reduce((count, pilot) => count + Number(overlaps(rect, pilot)), 0)
    if (covered < fewest) {
      best = rect
      fewest = covered
    }
    if (covered === 0) return rect
  }
  const y = boundedY(belowPills)
  const usable = { x: left, y, width: stage.width - 24, height: stage.y + stage.height - y - 8 }
  const center = { x: best.x + width / 2, y: best.y + best.height / 2 }
  const windowSize = { width, height: size.height }
  const free = findPilotLabelSpace(center, windowSize, usable, pilots, Infinity)
  if (free) return free
  // Very dense fleets may leave room for the window only between ship centers.
  const centers = pilots.map((pilot) => ({ x: pilot.x + pilot.width / 2, y: pilot.y + pilot.height / 2, width: 0, height: 0 }))
  return findPilotLabelSpace(center, windowSize, usable, centers, Infinity) ?? best
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

export function closestPoint(point: Point, rect: Rect): Point {
  return {
    x: Math.max(rect.x, Math.min(rect.x + rect.width, point.x)),
    y: Math.max(rect.y, Math.min(rect.y + rect.height, point.y)),
  }
}

export function labelObstacle(label: Rect): Rect {
  // The common 2 px clearance supplies the vertical gap.
  return { ...label, x: label.x - 4, width: label.width + 8 }
}

const maxLabelDistance = 40

function findPilotLabelSpace(center: Point, size: Size, bounds: Rect, occupied: readonly Rect[], reach: number): Rect | null {
  const minX = Math.max(bounds.x, center.x - reach - size.width)
  const maxX = Math.min(bounds.x + bounds.width - size.width, center.x + reach)
  const minY = Math.max(bounds.y, center.y - reach - size.height)
  const maxY = Math.min(bounds.y + bounds.height - size.height, center.y + reach)
  if (maxX < minX || maxY < minY) return null
  const preferredX = center.x - size.width / 2
  const preferredY = center.y - size.height / 2
  const obstacles = occupied.filter((rect) => rect.x - gap < maxX + size.width && rect.x + rect.width + gap > minX
    && rect.y - gap < maxY + size.height && rect.y + rect.height + gap > minY).sort((a, b) => a.x - b.x)
  const rows = new Set([Math.max(minY, Math.min(preferredY, maxY)), minY, maxY])
  for (const rect of obstacles) {
    rows.add(rect.y - size.height - gap)
    rows.add(rect.y + rect.height + gap)
  }
  let best: Rect | null = null
  let bestDistance = Infinity
  let bestAlignment = Infinity
  for (const y of rows) {
    if (y < minY || y > maxY) continue
    let left = minX
    function consider(right: number) {
      if (left > right) return
      const x = Math.max(left, Math.min(preferredX, right))
      const dx = Math.max(0, x - center.x, center.x - x - size.width)
      const dy = Math.max(0, y - center.y, center.y - y - size.height)
      const distance = Math.hypot(dx, dy)
      const alignment = Math.abs(preferredX - x) + Math.abs(preferredY - y)
      if (distance > reach || distance > bestDistance || (distance === bestDistance && alignment >= bestAlignment)) return
      bestDistance = distance
      bestAlignment = alignment
      best = { ...size, x, y }
    }
    for (const rect of obstacles) {
      if (y >= rect.y + rect.height + gap || y + size.height + gap <= rect.y) continue
      consider(Math.min(maxX, rect.x - gap - size.width))
      left = Math.max(left, rect.x + rect.width + gap)
      if (left > maxX) break
    }
    consider(maxX)
  }
  return best
}

export function placePilotLabel(center: Point, radius: number, size: Size, bounds: Rect, occupied: readonly Rect[],
  required = false, reach = maxLabelDistance) {
  const { x, y } = center
  const offset = radius + 5
  const left = x - size.width / 2
  const top = y - size.height / 2
  const nearby = [
    { ...size, x: left, y: y + offset },
    { ...size, x: left, y: y - offset - size.height },
    { ...size, x: x + offset, y: top },
    { ...size, x: x - offset - size.width, y: top },
  ]
  return placeAnnotation(nearby, bounds, occupied)
    ?? (required ? findPilotLabelSpace(center, size, bounds, occupied, reach) : null)
}

interface PilotLabel {
  center: Point
  radius: number
  size: Size
  bounds: Rect
  priority: number
  uploader: boolean
  required: boolean
}

export function placeReplayLabels<T extends PilotLabel>(labels: readonly T[], obstacles: readonly Rect[], stage: Rect, showAll = false,
  fallback = { bounds: stage, obstacles: [] as readonly Rect[] }) {
  const isMandatory = (label: T) => label.required || label.uploader
  const mandatory = showAll ? labels : labels.filter(isMandatory)
  const reachFromCenter = (label: T) => maxLabelDistance + (showAll ? label.radius + 2 : 0)
  const options = (label: T, occupied: readonly Rect[], width: number, bounds = label.bounds, reach = reachFromCenter(label)) =>
    placePilotLabel(label.center, label.radius, { ...label.size, width }, bounds, occupied, true, reach)

  function pack(limit: number, first?: ReadonlySet<T>, fromEdge = false) {
    const occupied = [...obstacles]
    const placed = new Map<T, Rect>()
    // Put pilots with little nearby room first, so pilots at the edge can use the gaps left over.
    const order = mandatory.map((label) => {
      const slot = options(label, obstacles, Math.min(limit, label.size.width))
      const nearest = slot && closestPoint(label.center, slot)
      const distance = nearest ? Math.hypot(nearest.x - label.center.x, nearest.y - label.center.y) : Infinity
      const { x, y } = label.center
      const edge = Math.min(x - stage.x, y - stage.y, stage.x + stage.width - x, stage.y + stage.height - y)
      return { label, distance, edge }
    }).sort((a, b) =>
      Number(first?.has(b.label) ?? false) - Number(first?.has(a.label) ?? false)
      || (fromEdge ? a.edge - b.edge : b.distance - a.distance))
    for (const { label } of order) {
      const slot = options(label, occupied, Math.min(limit, label.size.width))
      if (!slot) continue
      placed.set(label, slot)
      occupied.push(labelObstacle(slot))
    }
    return placed
  }

  let positions = pack(Infinity)
  if (showAll && positions.size < mandatory.length) {
    const missing = new Set(mandatory.filter((label) => !positions.has(label)))
    const rebalanced = pack(Infinity, missing)
    if (rebalanced.size > positions.size) positions = rebalanced
    const edgeFirst = pack(Infinity, undefined, true)
    if (edgeFirst.size > positions.size) positions = edgeFirst

    // Move a neighbor if its chosen slot is the only nearby one left for this label.
    for (const label of mandatory) {
      if (positions.has(label)) continue
      for (const [neighbor, rect] of positions) {
        const near = closestPoint(label.center, rect)
        if (Math.hypot(near.x - label.center.x, near.y - label.center.y) > reachFromCenter(label) + gap + 4) continue
        const occupied = [...obstacles]
        for (const [other, slot] of positions) if (other !== neighbor) occupied.push(labelObstacle(slot))
        const found = options(label, occupied, label.size.width)
        if (!found) continue
        const moved = options(neighbor, [...occupied, labelObstacle(found)], neighbor.size.width)
        if (!moved) continue
        positions.set(neighbor, moved)
        positions.set(label, found)
        break
      }
    }
  }
  if (showAll) {
    const occupied = [...obstacles, ...Array.from(positions.values(), labelObstacle)]
    for (const label of mandatory) {
      if (positions.has(label)) continue
      const fallbackSize = { width: Math.min(label.size.width, stage.width), height: Math.min(label.size.height, stage.height) }
      const fallback = { ...fallbackSize, x: label.center.x - fallbackSize.width / 2, y: label.center.y + label.radius + 5 }
      const slot = options(label, occupied, fallbackSize.width, stage, Infinity)
        ?? placeAnnotation([fallback], stage, occupied, true)!
      positions.set(label, slot)
      occupied.push(labelObstacle(slot))
    }
    return positions
  }

  const smallerWidths = [64, 54, 46, 38, 32, 26, 24]
  for (const width of smallerWidths) {
    if (positions.size === mandatory.length) break
    const retry = pack(width)
    if (retry.size > positions.size) positions = retry
    if (width <= 32 && retry.size < mandatory.length) {
      // A pilot with a short path can still have only one free slot. Let omitted
      // pilots claim a slot first, then try fitting their neighbors around them.
      const missing = new Set(mandatory.filter((label) => !retry.has(label)))
      const rebalanced = pack(width, missing)
      if (rebalanced.size > positions.size) positions = rebalanced
    }
  }

  // Reclaim space for longer names without taking an already placed required label's slot.
  for (const label of mandatory) {
    const slot = positions.get(label)
    if (slot?.width === label.size.width) continue
    const occupied = [...obstacles]
    for (const [other, rect] of positions) if (other !== label) occupied.push(labelObstacle(rect))
    const widths = [label.size.width, ...smallerWidths.filter((width) => width < label.size.width)]
    for (const width of widths) {
      if (slot && width <= slot.width) break
      const found = options(label, occupied, width)
      if (!found) continue
      positions.set(label, found)
      break
    }
  }

  const placedNames = Array.from(positions.values(), labelObstacle)
  const occupied = [...obstacles, ...placedNames]
  const protectedSpace = [...fallback.obstacles, ...placedNames]
  for (const label of mandatory) {
    if (positions.has(label)) continue
    const width = Math.min(46, label.size.width)
    const compactWidth = Math.min(24, width)
    const { bounds } = fallback
    const size = { width: Math.min(label.size.width, bounds.width), height: Math.min(label.size.height, bounds.height) }
    const below = { ...size, x: label.center.x - size.width / 2, y: label.center.y + label.radius + 5 }
    const slot = options(label, occupied, width, label.bounds, Infinity)
      ?? options(label, occupied, compactWidth, label.bounds, Infinity)
      ?? options(label, occupied, width, stage, Infinity)
      ?? options(label, occupied, compactWidth, stage, Infinity)
      // Relax ship clearance first and keep controls clear even if names have to overlap.
      ?? findPilotLabelSpace(label.center, size, bounds, protectedSpace, Infinity)
      ?? findPilotLabelSpace(label.center, { ...size, width: Math.min(compactWidth, size.width) }, bounds, protectedSpace, Infinity)
      ?? findPilotLabelSpace(label.center, size, bounds, fallback.obstacles, Infinity)
      ?? placeAnnotation([below], bounds, occupied, true)!
    positions.set(label, slot)
    const obstacle = labelObstacle(slot)
    protectedSpace.push(obstacle)
    occupied.push(obstacle)
  }

  const otherLabels = labels.filter((label) => !isMandatory(label)).sort((a, b) => b.priority - a.priority)
  for (const label of otherLabels) {
    const slot = placePilotLabel(label.center, label.radius, label.size, label.bounds, occupied)
    if (!slot) continue
    positions.set(label, slot)
    occupied.push(labelObstacle(slot))
  }
  return positions
}
