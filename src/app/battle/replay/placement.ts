import type { Point } from './layout-effects'

interface Size { width: number; height: number }
export interface Rect extends Point, Size {}

const gap = 2
export const shortMapHeight = 120

function overlaps(a: Rect, b: Rect) {
  return a.x < b.x + b.width + gap && a.x + a.width + gap > b.x
    && a.y < b.y + b.height + gap && a.y + a.height + gap > b.y
}

function fits(rect: Rect, bounds: Rect) {
  return rect.x >= bounds.x && rect.y >= bounds.y
    && rect.x + rect.width <= bounds.x + bounds.width
    && rect.y + rect.height <= bounds.y + bounds.height
}

export function placeShortMapWindow(rect: Rect, mapBottom: number, viewportHeight: number, collapsedHeight = 0): Rect {
  const height = Math.min(rect.height, viewportHeight - mapBottom)
  return { ...rect, height, y: Math.max(mapBottom, Math.min(rect.y, viewportHeight - (collapsedHeight || height))) }
}

interface HullCenter extends Point { radius: number }

export function findHullCenter(center: Point, radius: number, bounds: Rect,
  neighbors: readonly HullCenter[], chrome: readonly Rect[]): Point {
  const maxX = bounds.x + bounds.width
  const maxY = bounds.y + bounds.height
  const preferred = closestPoint(center, bounds)
  const chromeClearance = 2
  const blocked = chrome.filter((rect) => rect.y - chromeClearance < maxY
    && rect.y + rect.height + chromeClearance > bounds.y)
  let rows: number[] | undefined

  function nearest(separation: (other: HullCenter) => number) {
    const hitsCenter = blocked.some((rect) => preferred.x > rect.x - chromeClearance
      && preferred.x < rect.x + rect.width + chromeClearance && preferred.y > rect.y - chromeClearance
      && preferred.y < rect.y + rect.height + chromeClearance)
    if (!hitsCenter && neighbors.every((other) => Math.hypot(other.x - preferred.x, other.y - preferred.y) >= separation(other))) return preferred

    if (!rows) {
      rows = [preferred.y, bounds.y, maxY]
      for (let y = bounds.y + 4; y < maxY; y += 4) rows.push(y)
      rows.sort((a, b) => Math.abs(a - preferred.y) - Math.abs(b - preferred.y))
    }
    let best: Point | undefined
    let distance = Infinity
    for (const y of rows) {
      const dy = (preferred.y - y) ** 2
      if (dy >= distance) break
      // At this y, each hull or control excludes a horizontal interval.
      const intervals: Array<[number, number]> = []
      for (const other of neighbors) {
        const reach = separation(other)
        const delta = Math.abs(y - other.y)
        if (delta >= reach) continue
        const dx = Math.sqrt(reach * reach - delta * delta)
        intervals.push([other.x - dx, other.x + dx])
      }
      for (const rect of blocked) {
        if (y > rect.y - chromeClearance && y < rect.y + rect.height + chromeClearance) {
          intervals.push([rect.x - chromeClearance, rect.x + rect.width + chromeClearance])
        }
      }
      intervals.sort(([a], [b]) => a - b)
      let left = bounds.x
      function consider(right: number) {
        if (right < left) return
        const x = Math.max(left, Math.min(right, preferred.x))
        const score = (preferred.x - x) ** 2 + dy
        if (score >= distance) return
        best = { x, y }
        distance = score
      }
      for (const [start, end] of intervals) {
        if (end <= left) continue
        consider(Math.min(start, maxX))
        left = end
        if (left > maxX) break
      }
      consider(maxX)
    }
    return best
  }

  // Reserve a clear ring first. In a saturated area keep the centers independently hittable.
  return nearest((other) => radius + other.radius + 5)
    ?? nearest((other) => Math.max(radius, other.radius) + 3)
    ?? preferred
}

export function placeFightsWindow(stage: Rect, topRight: number, belowPills: number, size: Size, pilots: readonly Rect[],
  controls: readonly Rect[] = []): Rect {
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
    if (controls.some((control) => overlaps(rect, control))) continue
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
  const free = findPilotLabelSpace(center, windowSize, usable, [...pilots, ...controls], Infinity)
  if (free) return free
  // Very dense fleets may leave room for the window only between ship centers.
  const centers = pilots.map((pilot) => ({ x: pilot.x + pilot.width / 2, y: pilot.y + pilot.height / 2, width: 0, height: 0 }))
  return findPilotLabelSpace(center, windowSize, usable, [...centers, ...controls], Infinity) ?? best
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

function findPilotLabelSpace(center: Point, size: Size, bounds: Rect, occupied: readonly Rect[], reach: number,
  clearance = gap): Rect | null {
  const minX = Math.max(bounds.x, center.x - reach - size.width)
  const maxX = Math.min(bounds.x + bounds.width - size.width, center.x + reach)
  const minY = Math.max(bounds.y, center.y - reach - size.height)
  const maxY = Math.min(bounds.y + bounds.height - size.height, center.y + reach)
  if (maxX < minX || maxY < minY) return null
  const preferredX = center.x - size.width / 2
  const preferredY = center.y - size.height / 2
  const obstacles = occupied.filter((rect) => rect.x - clearance < maxX + size.width && rect.x + rect.width + clearance > minX
    && rect.y - clearance < maxY + size.height && rect.y + rect.height + clearance > minY).sort((a, b) => a.x - b.x)
  const rows = new Set([Math.max(minY, Math.min(preferredY, maxY)), minY, maxY])
  for (const rect of obstacles) {
    rows.add(rect.y - size.height - clearance)
    rows.add(rect.y + rect.height + clearance)
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
      if (y >= rect.y + rect.height + clearance || y + size.height + clearance <= rect.y) continue
      consider(Math.min(maxX, rect.x - clearance - size.width))
      left = Math.max(left, rect.x + rect.width + clearance)
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
  const reachFromCenter = (label: T) => maxLabelDistance + (showAll && !isMandatory(label) ? label.radius + 2 : 0)
  const minimumWidth = (label: T) => label.priority >= 3 ? 34 : 24
  const sizeAt = (label: T, limit: number, bounds = label.bounds) => ({
    width: Math.min(label.size.width, bounds.width, Math.max(minimumWidth(label), limit)),
    height: Math.min(label.size.height, bounds.height),
  })
  const options = (label: T, occupied: readonly Rect[], limit: number, bounds = label.bounds) =>
    placePilotLabel(label.center, label.radius, sizeAt(label, limit, bounds), bounds, occupied, true, reachFromCenter(label))
  const centers = labels.map(({ center }) => ({ ...center, width: 0, height: 0 }))
  const preferred = { bounds: (label: T) => label.bounds, obstacles }
  const fullStage = { bounds: () => fallback.bounds, obstacles }
  const ringEdges = { bounds: () => fallback.bounds, obstacles: [...fallback.obstacles, ...centers] }
  const controlsOnly = { bounds: () => fallback.bounds, obstacles: fallback.obstacles }
  const widths = [64, 54, 46, 38, 32, 26, 24]
  const essential = new Set(mandatory.filter(isMandatory))
  const essentialCount = (positions: ReadonlyMap<T, Rect>) => [...essential].filter((label) => positions.has(label)).length
  function zoomEdgeSlot(label: T, limit: number, bounds: Rect, chrome: readonly Rect[], names: Iterable<Rect>) {
    const separatedNames = Array.from(names, (rect) => ({
      x: rect.x - 4 - gap, y: rect.y - gap, width: rect.width + 8 + 2 * gap, height: rect.height + 2 * gap,
    }))
    // A zoomed label can meet a control edge and use the existing reach from its hull ring.
    // Preserve the full separation between pilot names.
    const reach = isMandatory(label) ? maxLabelDistance + label.radius + 2 + 0.02 : Infinity
    return findPilotLabelSpace(label.center, sizeAt(label, limit, bounds), bounds, [...chrome, ...separatedNames], reach, 0)
  }

  function pack(limit: number, area = preferred, first?: ReadonlySet<T>, allowLongLeaders = false) {
    const occupied = [...area.obstacles]
    const positions = new Map<T, Rect>()
    // Fit the pilots constrained by map edges and chrome before their neighbors.
    const order = mandatory.map((label) => {
      const slot = options(label, area.obstacles, limit, area.bounds(label))
      const near = slot && closestPoint(label.center, slot)
      const distance = near ? Math.hypot(near.x - label.center.x, near.y - label.center.y) : Infinity
      return { label, distance }
    }).sort((a, b) => Number(first?.has(b.label) ?? false) - Number(first?.has(a.label) ?? false)
      || (allowLongLeaders ? Number(isMandatory(b.label)) - Number(isMandatory(a.label)) : 0)
      || b.distance - a.distance || b.label.priority - a.label.priority)
    for (const { label } of order) {
      const bounds = area.bounds(label)
      const slot = options(label, occupied, limit, bounds)
        // Fill every available slot before expanding names.
        ?? (allowLongLeaders ? zoomEdgeSlot(label, limit, bounds, area.obstacles, positions.values()) : null)
      if (!slot) continue
      positions.set(label, slot)
      occupied.push(labelObstacle(slot))
    }
    return positions
  }

  let area = preferred
  let positions = pack(Infinity)
  let essentialPlaced = essentialCount(positions)
  const improves = (retry: ReadonlyMap<T, Rect>, count: number) =>
    count > essentialPlaced || count === essentialPlaced && retry.size > positions.size
  for (const candidate of [preferred, fullStage, ringEdges, controlsOnly]) {
    if (positions.size === mandatory.length) break
    for (const width of candidate === preferred ? widths : [Infinity, ...widths]) {
      let retry = pack(width, candidate)
      if (retry.size < mandatory.length && width <= 38) {
        const missing = new Set(mandatory.filter((label) => !retry.has(label)))
        const rebalanced = pack(width, candidate, missing)
        if (rebalanced.size > retry.size) retry = rebalanced
      }
      const count = essentialCount(retry)
      if (!improves(retry, count)) continue
      positions = retry
      essentialPlaced = count
      area = candidate
      if (positions.size === mandatory.length) break
    }
  }
  if (showAll && positions.size < mandatory.length) {
    let retry = pack(24, controlsOnly, essential, true)
    if (essentialCount(retry) < essential.size) {
      const missing = new Set([...essential].filter((label) => !retry.has(label)))
      const reordered = pack(24, controlsOnly, missing, true)
      if (essentialCount(reordered) > essentialCount(retry)) retry = reordered
    }
    if (improves(retry, essentialCount(retry))) {
      positions = retry
      area = controlsOnly
    }
  }

  // Expand shortened names where their neighbors have left room.
  for (const label of mandatory) {
    const slot = positions.get(label)
    if (slot?.width === label.size.width) continue
    const occupied = [...area.obstacles]
    for (const [other, rect] of positions) if (other !== label) occupied.push(labelObstacle(rect))
    for (const width of [Infinity, ...widths]) {
      if (slot && sizeAt(label, width, area.bounds(label)).width <= slot.width) break
      const found = options(label, occupied, width, area.bounds(label))
      if (!found) continue
      positions.set(label, found)
      break
    }
  }

  const occupied = [...obstacles, ...Array.from(positions.values(), labelObstacle)]
  for (const label of mandatory) {
    if (positions.has(label)) continue
    const { bounds, obstacles: chrome } = fallback
    const size = sizeAt(label, Infinity, bounds)
    const below = { ...size, x: label.center.x - size.width / 2, y: label.center.y + label.radius + 5 }
    // An arbitrarily crowded viewport still shows every required name next to its hull.
    const clear = [...chrome, ...Array.from(positions.values(), labelObstacle)]
    const narrow = sizeAt(label, minimumWidth(label), bounds)
    const slot = options(label, clear, Infinity, bounds) ?? options(label, clear, narrow.width, bounds)
      ?? (showAll ? zoomEdgeSlot(label, narrow.width, bounds, chrome, positions.values()) : null)
      ?? options(label, chrome, Infinity, bounds) ?? options(label, chrome, narrow.width, bounds)
      ?? placeAnnotation([below], bounds, [], true)!
    positions.set(label, slot)
    occupied.push(labelObstacle(slot))
  }
  if (showAll) return positions

  const otherLabels = labels.filter((label) => !isMandatory(label)).sort((a, b) => b.priority - a.priority)
  for (const label of otherLabels) {
    const slot = placePilotLabel(label.center, label.radius, label.size, label.bounds, occupied)
    if (!slot) continue
    positions.set(label, slot)
    occupied.push(labelObstacle(slot))
  }
  return positions
}
