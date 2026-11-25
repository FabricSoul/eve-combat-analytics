import type { Point } from './layout-effects'

interface Size { width: number; height: number }
export interface Rect extends Point, Size {}

const gap = 2
export const shortMapHeight = 120
export const packedControlsHeight = 100

function overlaps(a: Rect, b: Rect, clearance = gap) {
  return a.x < b.x + b.width + clearance && a.x + a.width + clearance > b.x
    && a.y < b.y + b.height + clearance && a.y + a.height + clearance > b.y
}

function fits(rect: Rect, bounds: Rect) {
  return rect.x >= bounds.x && rect.y >= bounds.y
    && rect.x + rect.width <= bounds.x + bounds.width
    && rect.y + rect.height <= bounds.y + bounds.height
}

export function placeReplayWindow(rect: Rect, viewport: Rect, controls: readonly Rect[], barHeight: number, collapsed: boolean,
  alignWithHeader = false): Rect {
  const height = collapsed ? barHeight : rect.height
  const visible = { ...rect, height }
  if (fits(visible, viewport) && controls.every((control) => !overlaps(visible, control, 0))) return rect

  // Each control splits a free rectangle into strips. The strips can overlap,
  // so a window can still fit in the widest or tallest gap around a control.
  const regions = replayWindowRegions(viewport, controls, rect.width, barHeight)
  let best = rect
  let bestHeight = 0
  let distance = Infinity
  for (const region of regions) {
    const visibleHeight = Math.min(height, region.height)
    const x = Math.max(region.x, Math.min(rect.x, region.x + region.width - rect.width))
    const y = Math.max(region.y, Math.min(rect.y, region.y + region.height - visibleHeight))
    const dx = x - rect.x
    const dy = y - rect.y
    const movement = alignWithHeader ? Math.abs(dy) * viewport.width + Math.abs(dx) : Math.hypot(dx, dy)
    if (visibleHeight > bestHeight || (visibleHeight === bestHeight && movement < distance)) {
      best = { ...rect, x, y, height: collapsed ? rect.height : visibleHeight }
      bestHeight = visibleHeight
      distance = movement
    }
  }
  return best
}

export function replayWindowRegions(viewport: Rect, controls: readonly Rect[], minWidth: number, minHeight: number) {
  if (viewport.width < minWidth || viewport.height < minHeight) return []
  return controls.reduce<Rect[]>((free, control) => free.flatMap((region) => {
    if (!overlaps(region, control, 0)) return [region]
    const right = control.x + control.width
    const bottom = control.y + control.height
    return [
      { ...region, width: control.x - region.x },
      { ...region, x: right, width: region.x + region.width - right },
      { ...region, height: control.y - region.y },
      { ...region, y: bottom, height: region.y + region.height - bottom },
    ].filter((strip) => strip.width >= minWidth && strip.height >= minHeight)
  }), [viewport])
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

// Keep the visible box inside the reach after fractional CSS pixel rounding.
const maxLabelDistance = 40 - 1 / 32
type LanePacking = 'nearest' | 'tight' | 'left' | 'right' | 'row-left' | 'row-right'

function findPilotLabelSpace(center: Point, size: Size, bounds: Rect, occupied: readonly Rect[], reach: number,
  clearance = gap, lanes?: readonly number[], packing: LanePacking = 'nearest'): Rect | null {
  const packTightly = packing === 'tight'
  const fromLeft = packing === 'left' || packing === 'row-left'
  const fromRight = packing === 'right' || packing === 'row-right'
  const rowFirst = packing === 'row-left' || packing === 'row-right'
  const leftEdge = bounds.x
  const rightEdge = bounds.x + bounds.width - size.width
  const minX = Math.max(leftEdge, center.x - reach - size.width)
  const maxX = Math.min(rightEdge, center.x + reach)
  const minY = Math.max(bounds.y, center.y - reach - size.height)
  const maxY = Math.min(bounds.y + bounds.height - size.height, center.y + reach)
  if (maxX < minX || maxY < minY) return null
  const preferredX = center.x - size.width / 2
  const preferredY = center.y - size.height / 2
  const obstacles = occupied.filter((rect) => (packTightly || rect.x - clearance < maxX + size.width && rect.x + rect.width + clearance > minX)
    && rect.y - clearance < maxY + size.height && rect.y + rect.height + clearance > minY).sort((a, b) => a.x - b.x)
  const rows = new Set([Math.max(minY, Math.min(preferredY, maxY)), minY, maxY])
  for (const rect of obstacles) {
    rows.add(rect.y - size.height - clearance)
    rows.add(rect.y + rect.height + clearance)
  }
  let best: Rect | null = null
  let bestDistance = Infinity
  let bestAlignment = Infinity
  let bestWaste = Infinity
  let bestCross = Infinity
  for (const y of lanes ?? rows) {
    if (y < minY || y > maxY) continue
    let left = packTightly ? leftEdge : minX
    const rightmost = packTightly ? rightEdge : maxX
    function consider(right: number) {
      if (left > right) return
      const dy = Math.max(0, y - center.y, center.y - y - size.height)
      const horizontalReach = Math.sqrt(Math.max(0, (reach - dy) * (reach + dy)))
      const start = Math.max(left, center.x - horizontalReach - size.width)
      const end = Math.min(right, center.x + horizontalReach)
      if (start > end) return
      const cross = fromLeft ? start : fromRight ? -end : 0
      const waste = rowFirst ? dy : cross || (packTightly ? right - left : 0)
      const tie = rowFirst ? cross : 0
      const x = fromLeft ? start : fromRight ? end
        : packTightly ? (start - left <= right - end ? start : end) : Math.max(start, Math.min(preferredX, end))
      const dx = Math.max(0, x - center.x, center.x - x - size.width)
      const distance = Math.hypot(dx, dy)
      const alignment = Math.abs(preferredX - x) + Math.abs(preferredY - y)
      if (distance > reach + 1e-7 || waste > bestWaste
        || (waste === bestWaste && (tie > bestCross || (tie === bestCross
          && (distance > bestDistance || (distance === bestDistance && alignment >= bestAlignment)))))) return
      bestWaste = waste
      bestCross = tie
      bestDistance = distance
      bestAlignment = alignment
      best = { ...size, x, y }
    }
    for (const rect of obstacles) {
      if (y >= rect.y + rect.height + clearance || y + size.height + clearance <= rect.y) continue
      consider(Math.min(rightmost, rect.x - clearance - size.width))
      left = Math.max(left, rect.x + rect.width + clearance)
      if (left > rightmost) break
    }
    consider(rightmost)
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
  compactSize?: Size
  wrappedSize?: Size
  bounds: Rect
  priority: number
  uploader: boolean
  required: boolean
}

interface LabelPlacement extends Rect { compact?: true; wrapped?: true; scaleX?: number }

export function placeReplayLabels<T extends PilotLabel>(labels: readonly T[], obstacles: readonly Rect[], stage: Rect, showAll = false,
  fallback = { bounds: stage, obstacles: [] as readonly Rect[] }) {
  const isMandatory = (label: T) => label.required || label.uploader
  const mandatory = showAll ? labels : labels.filter(isMandatory)
  const full = fallback.bounds
  const centers = labels.map(({ center }) => ({ ...center, width: 0, height: 0 }))
  const localReach = (label: T) => maxLabelDistance + (isMandatory(label) ? 0 : label.radius + 2)
  function edgeReach(label: T) {
    if (!showAll) return localReach(label)
    // For a partially visible hull, the zoom leader can start on its ring.
    return maxLabelDistance + (full.height >= packedControlsHeight || !isMandatory(label) ? label.radius + 2 : 0)
  }
  function sizeAt(label: T, compact: boolean, wrap = false, scaleX = 1): Omit<LabelPlacement, 'x' | 'y'> {
    const wrapped = wrap ? label.wrappedSize : undefined
    const small = compact || label.size.width > full.width ? wrapped ?? label.compactSize : undefined
    const size = small ?? label.size
    const width = Math.min(size.width * scaleX, full.width)
    const measured = { width, height: Math.min(size.height, full.height) }
    return { ...measured, compact: small ? true : undefined, wrapped: wrapped ? true : undefined,
      scaleX: scaleX === 1 ? undefined : scaleX }
  }

  const widerFirst = (a: T, b: T) => sizeAt(b, true).width - sizeAt(a, true).width
  function pack(blocked: readonly Rect[], compact: boolean, localBounds = false, lanes?: readonly number[],
    orderBy: (a: T, b: T) => number = widerFirst, packing: LanePacking = 'nearest', wrap = false, scaleX = 1,
    lanePad = 1) {
    const occupied = [...blocked]
    const positions = new Map<T, LabelPlacement>()
    const order = [...mandatory].sort((a, b) => (showAll && lanes ? 0 : Number(isMandatory(b)) - Number(isMandatory(a))) || orderBy(a, b))
    for (const label of order) {
      const bounds = localBounds ? label.bounds : full
      const size = sizeAt(label, compact, wrap, scaleX)
      const reach = showAll && lanes ? edgeReach(label) : localReach(label)
      const extended = showAll && blocked === fallback.obstacles ? edgeReach(label) : reach
      const slot = (lanes ? findPilotLabelSpace(label.center, size, bounds, occupied, reach, 0, lanes, packing)
        : placePilotLabel(label.center, label.radius, size, bounds, occupied, true, reach))
        ?? (extended > reach ? findPilotLabelSpace(label.center, size, full, occupied, extended, gap) : null)
      if (!slot) continue
      positions.set(label, { ...slot, ...size })
      occupied.push(lanes ? { ...slot, x: slot.x - lanePad, width: slot.width + lanePad * 2 } : labelObstacle(slot))
    }
    return positions
  }

  let positions = pack(obstacles, false, true)
  const countEssential = (result: ReadonlyMap<T, Rect>) => mandatory.filter((label) => isMandatory(label) && result.has(label)).length
  function tryPack(retry: Map<T, LabelPlacement>) {
    const essential = countEssential(retry) - countEssential(positions)
    if (essential > 0 || essential === 0 && retry.size > positions.size) {
      positions = retry
    }
  }
  if (positions.size < mandatory.length) tryPack(pack(obstacles, false))
  if (positions.size < mandatory.length) tryPack(pack(obstacles, true))
  const centerObstacles = [...fallback.obstacles, ...centers]
  if (positions.size < mandatory.length) tryPack(pack(centerObstacles, true))
  if (full.height > shortMapHeight && positions.size < mandatory.length) tryPack(pack(fallback.obstacles, true))

  // On very short maps, align names to rows so that vertical gaps do not strand usable space.
  const lineHeight = Math.max(1, ...mandatory.map((label) => sizeAt(label, true).height))
  const leftToRight = (a: T, b: T) => a.center.x - b.center.x
  const rightToLeft = (a: T, b: T) => b.center.x - a.center.x
  function packLanes(blocked: readonly Rect[], step: number, wrap = false, scaleX = 1, first?: T, lanePad = 1) {
    if (positions.size === mandatory.length) return
    const laneCount = Math.floor((full.height - lineHeight) / step) + 1
    const slack = full.height - lineHeight - (laneCount - 1) * step
    const offsets = new Set([0, slack, Math.floor(slack / 2)])
    if (wrap || first || lanePad === 0) for (let offset = 1; offset < step; offset++) offsets.add(offset)
    for (const offset of offsets) {
      if (positions.size === mandatory.length) break
      const lanes = Array.from({ length: laneCount }, (_, index) => full.y + offset + index * step)
      const strategies: readonly (readonly [LanePacking, (a: T, b: T) => number])[] = [
        ['nearest', widerFirst], ['nearest', leftToRight], ['nearest', rightToLeft], ['tight', widerFirst],
        ...(showAll || lanePad > 1 ? [
          ['left', leftToRight], ['right', rightToLeft], ['row-left', leftToRight], ['row-right', rightToLeft],
        ] as const : []),
      ]
      for (const [packing, order] of strategies) {
        if (positions.size === mandatory.length) break
        const firstThenOrder = first ? (a: T, b: T) => Number(b === first) - Number(a === first) || order(a, b) : order
        tryPack(pack(blocked, true, false, lanes, firstThenOrder, packing, wrap, scaleX, lanePad))
      }
      if ((wrap || lanePad === 0) && positions.size < mandatory.length) {
        // A label can lose most of its nearby area to chrome even when its center is in view.
        const room = new Map(mandatory.map((label) => {
          const size = sizeAt(label, true, wrap, scaleX)
          const count = lanes.filter((y) => findPilotLabelSpace(label.center, size, full, blocked, edgeReach(label), 0, [y])).length
          return [label, count]
        }))
        const leastRoom = (a: T, b: T) => room.get(a)! - room.get(b)! || widerFirst(a, b)
        tryPack(pack(blocked, true, false, lanes, leastRoom, 'nearest', wrap, scaleX, lanePad))
        if (positions.size < mandatory.length) tryPack(pack(blocked, true, false, lanes, leastRoom, 'tight', wrap, scaleX, lanePad))
      }
    }
  }
  if (!showAll) {
    packLanes(centerObstacles, lineHeight + gap, false, 1, undefined, 6)
    packLanes(fallback.obstacles, lineHeight + gap, false, 1, undefined, 6)
    packLanes(centerObstacles, lineHeight + 1)
  }
  packLanes(fallback.obstacles, lineHeight + 1)
  if (showAll) packLanes(fallback.obstacles, lineHeight)
  if (positions.size < mandatory.length) tryPack(pack(fallback.obstacles, true))
  if (showAll) {
    tryPack(pack(fallback.obstacles, true, false, undefined, widerFirst, 'nearest', true))
    packLanes(fallback.obstacles, lineHeight, true)
    packLanes(fallback.obstacles, lineHeight, true, 0.8)
    packLanes(fallback.obstacles, lineHeight + 1, false, 0.8)
    packLanes(fallback.obstacles, lineHeight, false, 0.8)
    const missing = mandatory.find((label) => !positions.has(label))
    if (missing) packLanes(fallback.obstacles, lineHeight, false, 0.8, missing)
    packLanes(fallback.obstacles, lineHeight, false, 0.75)
    packLanes(fallback.obstacles, lineHeight, false, 0.75, undefined, 0)
    const constrained = mandatory.find((label) => !positions.has(label))
    if (constrained) packLanes(fallback.obstacles, lineHeight, true, 0.75, constrained, 0)
    // A nearly complete packing can miss a wide name by one or two occupied
    // slots. Move those neighbours locally instead of sending the name away.
    for (const label of mandatory.filter((candidate) => !positions.has(candidate))) {
      const rows = [...new Set([full.y, full.y + full.height - lineHeight, ...[...positions.values(), ...fallback.obstacles]
        .flatMap((rect) => [rect.y, rect.y + rect.height, rect.y - lineHeight])])]
      const compact = sizeAt(label, true)
      const sizes = [compact, sizeAt(label, true, true), sizeAt(label, true, false, 0.8)]
      const candidates = sizes.flatMap((size) => rows.flatMap((row) =>
        (['nearest', 'left', 'right'] as const).flatMap((packing) => {
          const slot = findPilotLabelSpace(label.center, size, full, fallback.obstacles, edgeReach(label), 0, [row], packing)
          if (!slot) return []
          const blocked = [...positions].filter(([, rect]) => overlaps(slot, rect, 0))
          return blocked.length <= 3 ? [{ slot: { ...slot, ...size }, blocked }] : []
        })))
      candidates.sort((a, b) => a.blocked.length - b.blocked.length)
      for (const { slot, blocked } of candidates.slice(0, 36)) {
        const retry = new Map(positions)
        for (const [other] of blocked) retry.delete(other)
        retry.set(label, slot)
        const occupied = [...fallback.obstacles, ...retry.values()]
        for (const [other, size] of blocked) {
          const replacement = findPilotLabelSpace(other.center, size, full, occupied, edgeReach(other), 0)
          if (!replacement) break
          retry.set(other, replacement)
          occupied.push(replacement)
        }
        if (retry.size > positions.size) {
          positions = retry
          break
        }
      }
    }
    return positions
  }

  const occupied = [...obstacles, ...Array.from(positions.values(), labelObstacle)]
  for (const label of mandatory) {
    if (positions.has(label)) continue
    const size = sizeAt(label, true)
    const clear = [...fallback.obstacles, ...Array.from(positions.values(), labelObstacle)]
    // Preserve the full name and its association with the hull even when the map is saturated.
    const slot = findPilotLabelSpace(label.center, size, full, clear, edgeReach(label), 0)
      ?? findPilotLabelSpace(label.center, size, full, clear, Infinity, 0)
      ?? findPilotLabelSpace(label.center, size, full, fallback.obstacles, edgeReach(label), 0)
      ?? findPilotLabelSpace(label.center, size, full, fallback.obstacles, Infinity, 0)
    if (!slot) continue
    positions.set(label, size.compact ? { ...slot, compact: true } : slot)
    occupied.push(labelObstacle(slot))
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
