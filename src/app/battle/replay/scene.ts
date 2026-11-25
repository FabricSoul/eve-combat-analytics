import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import type { Analysis, Entity, EntityKey, Interaction, Killmail } from '@/core/contract'
import shipTypes from '@/core/data/ship-types.json'
import { sideColor, sideLetter } from '@/app/lib/sides'
import { interactionScales, sideAnchors, type Point } from './layout-effects'
import { findHullCenter, type Rect } from './placement'
import { makePresence } from './presence'

const shipById = new Map(shipTypes.map((ship) => [ship.id, ship]))
const shipIdByName = new Map(shipTypes.flatMap(({ id, en, zh }) => [[en, id] as const, [zh, id] as const]))

export interface ReplayPilot {
  entity: Entity
  ship: string | null
  shipId: number | null
  primaryEnemy: boolean
  color: string
  letter: string | null
  deaths: { t: number }[]
}

export interface ReplayNode extends ReplayPilot, SimulationNodeDatum {
  x: number
  y: number
  ordinal: number
  radius: number
  labeled: boolean
}

export interface ReplayEdge extends Interaction {
  strength: number
}

export function buildScene(analysis: Analysis, killmails: readonly Killmail[], order: readonly number[]) {
  const active = new Set<EntityKey>()
  const incoming = new Map<EntityKey, number>()
  const deaths = new Map<number, Killmail[]>()
  const reportedShips = new Map<number, number>()
  for (const killmail of killmails) {
    const { victim, attackers } = killmail
    if (victim.charId !== null) {
      const previous = deaths.get(victim.charId) ?? []
      previous.push(killmail)
      deaths.set(victim.charId, previous)
    }
    for (const { charId, shipTypeId } of [victim, ...attackers]) {
      if (charId !== null && shipTypeId !== null && !reportedShips.has(charId)) reportedShips.set(charId, shipTypeId)
    }
  }
  const scales = interactionScales(analysis.interactions)
  const edges = analysis.interactions.map((edge): ReplayEdge => {
    active.add(edge.from)
    active.add(edge.to)
    if (edge.kind === 'damage') incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + edge.amount)
    return { ...edge, strength: scales[edge.kind](edge.amount) }
  })
  const entities = Object.values(analysis.entities)
  const primaryEnemies = new Set(entities
    .filter(({ key, side }) => active.has(key) && side >= 0 && side !== order[0])
    .sort((a, b) => (incoming.get(b.key) ?? 0) - (incoming.get(a.key) ?? 0))
    .slice(0, 8)
    .map(({ key }) => key))

  function pilot(entity: Entity): ReplayPilot {
    const { key, side, charId } = entity
    const ship = entity.shipTypes[0]
    const aggregateId = key.startsWith('ship:') ? Number(key.split(':')[1]) : null
    const reportId = charId === null ? null : reportedShips.get(charId) ?? null
    const shipId = (ship ? shipIdByName.get(ship) : null) ?? aggregateId ?? reportId
    return {
      entity,
      ship: ship ?? (shipId === null ? null : shipById.get(shipId)?.en ?? null),
      shipId,
      primaryEnemy: primaryEnemies.has(key),
      color: sideColor(side, order),
      letter: sideLetter(side, order),
      deaths: charId === null ? [] : (deaths.get(charId) ?? []).sort((a, b) => a.t - b.t),
    }
  }

  const pilots = entities.map(pilot)
  const pointSpans = analysis.ewarSpans.filter(({ ewar }) => ewar === 'warp_disrupt' || ewar === 'warp_scramble')
  function recentOpponents(recent: ReadonlyMap<EntityKey, number>) {
    const ranked = [...recent].filter(([key]) => {
      const side = analysis.entities[key]?.side
      return side !== undefined && side >= 0 && side !== order[0]
    })
    ranked.sort((a, b) => b[1] - a[1])
    return new Set(ranked.slice(0, 8).map(([key]) => key))
  }
  return { pilots, edges, pointSpans, recentOpponents, visibleAt: makePresence(pilots, edges, order[0]) }
}

interface LayoutPositions {
  byKey: ReadonlyMap<EntityKey, ReplayNode>
  row: { slots: number; seats: ReadonlyMap<EntityKey, number> }
  placed: ReadonlySet<EntityKey>
}

interface CombatLink extends SimulationLinkDatum<ReplayNode> {
  source: ReplayNode
  target: ReplayNode
  count: number
}

export function makeLayout(pilots: readonly ReplayPilot[], order: readonly number[], width: number, height: number, topInset = 0) {
  const populations = new Map<number, number>()
  for (const { entity: { charId, side } } of pilots) {
    if (charId !== null && side >= 0 && side !== order[0]) populations.set(side, (populations.get(side) ?? 0) + 1)
  }
  const anchors = sideAnchors(order, width, height, populations)
  const anchorOrder = [...anchors.keys()].join(',')
  const compact = height < 420
  // Match the compact controls breakpoint. Use the longer axis for the two fleets.
  const split: 'x' | 'y' | null = width <= 430 && order.length === 2 ? (width >= height ? 'x' : 'y') : null
  // Give the fleet with more required names a little extra space.
  const logBalance = split ? pilots.reduce((balance, { entity }) => !entity.hasLog ? balance
    : balance + (entity.side === order[0] ? 1 : entity.side === order[1] ? -1 : 0), 0) : 0
  const splitRatio = 0.5 + Math.sign(logBalance) * 0.05
  const compactTop = 57
  const topReserve = Math.max(split ? compactTop : 42, topInset)
  const bottomInset = pilots.some(({ entity }) => entity.side === -1) ? 41 : 0
  const largestInset = (compact ? 12 : 15) + 5
  // Compress the layout clearances when the map cannot fit its usual spacing.
  const fleetHeight = 6 * largestInset
  const spacingScale = Math.min(1, height / (topReserve + Math.max(bottomInset, 20) + fleetHeight))
  const top = topReserve * spacingScale
  const confineDuringSettling = Boolean(split) || spacingScale < 1
  // Allocate more of the space lost to wrapped controls to the fleet with fewer names.
  const upperFleetShare = 0.5 + Math.sign(logBalance) * 0.35
  const verticalDivider = height * splitRatio + Math.max(0, topInset - compactTop) * upperFleetShare * spacingScale
  if (split === 'x') {
    anchors.get(order[0]!)!.x = width * 0.28
    anchors.get(order[1]!)!.x = width * 0.84
  } else if (split === 'y') {
    anchors.set(order[0]!, { x: width / 2, y: height * 0.37 })
    anchors.set(order[1]!, { x: width / 2, y: height * 0.72 })
  }
  const nodes = pilots.map((pilot, index): ReplayNode => {
    const { hasLog, side } = pilot.entity
    const anchor = anchors.get(side) ?? anchors.get(-1)!
    const angle = index * Math.PI * (3 - Math.sqrt(5))
    const spread = Math.sqrt(index + 1) * 7
    const radius = hasLog ? (compact ? 12 : 15) : pilot.primaryEnemy ? (compact ? 11 : 13) : (compact ? 8 : 9)
    return {
      ...pilot,
      ordinal: index,
      x: anchor.x + Math.cos(angle) * spread,
      y: anchor.y + Math.sin(angle) * spread * spacingScale,
      radius,
      labeled: hasLog || (!compact && pilot.primaryEnemy),
    }
  })
  const byKey = new Map(nodes.map((node) => [node.entity.key, node]))
  const assigned = nodes.filter(({ entity }) => entity.side !== -1)
  let activeNodes: ReplayNode[] = []
  const placed = new Set<EntityKey>()
  const unassigned = nodes.filter(({ entity }) => entity.side === -1)
  const anchorFor = ({ entity }: ReplayNode) => anchors.get(entity.side) ?? anchors.get(-1)!

  function formationApproach(exchanges: Iterable<readonly [number, number]>) {
    const offsets = new Map<number, Point>()
    const opponents = new Map<number, Point[]>()
    for (const [a, b] of exchanges) {
      const own = anchors.get(a)
      const other = anchors.get(b)
      if (!own || !other) continue
      opponents.set(a, [...opponents.get(a) ?? [], other])
      opponents.set(b, [...opponents.get(b) ?? [], own])
    }
    for (const [side, targets] of opponents) {
      const anchor = anchors.get(side)!
      const dx = targets.reduce((sum, target) => sum + target.x - anchor.x, 0) / targets.length
      const dy = targets.reduce((sum, target) => sum + target.y - anchor.y, 0) / targets.length
      // Advance the engaged formations together. Per-pilot links still pull the individual exchanges.
      const fraction = Math.min(0.18, 72 / Math.max(1, Math.hypot(dx, dy)))
      offsets.set(side, { x: dx * fraction, y: dy * fraction })
    }
    return offsets
  }

  function confine(node: ReplayNode, x: number, y: number) {
    const inset = node.radius + 5
    const ours = node.entity.side === order[0]
    const minX = split === 'x' && !ours ? width * splitRatio + inset : inset
    const maxX = split === 'x' && ours ? width * splitRatio - inset : width - inset
    const ceiling = split === 'y' && !ours ? Math.max(verticalDivider, top) : top
    const minY = ceiling + inset
    const floor = height - inset - Math.max(bottomInset, node.labeled ? 20 : 8) * spacingScale
    const maxY = split === 'y' && ours ? Math.min(floor, verticalDivider - inset) : floor
    return { x: Math.max(minX, Math.min(maxX, x)), y: Math.max(minY, Math.min(maxY, y)) }
  }

  const smallShipMargin = split === 'y' ? 2 : 2.15
  const velocityDecay = 0.35
  const velocityFactor = 1 - velocityDecay
  const links = forceLink<ReplayNode, CombatLink>()
    .distance(({ source, target }) => source.entity.side === target.entity.side ? 70 : Math.min(width * 0.28, 280))
    .strength(({ count }) => Math.min(0.12, 0.02 * count))
  const simulation = forceSimulation<ReplayNode>([]).stop()
    .force('x', forceX<ReplayNode>((node) => anchorFor(node).x).strength(0.09))
    .force('y', forceY<ReplayNode>((node) => anchorFor(node).y).strength(split === 'y' || order.length >= 3 ? 0.10 : 0.025))
    .force('collide', forceCollide<ReplayNode>(({ radius, labeled, entity }) => {
      const margin = split ? (entity.hasLog ? 6 : smallShipMargin) : labeled ? 26 : 8
      return radius + margin * spacingScale
    }).strength(0.9))
    .force('charge', forceManyBody().strength(split ? -80 : -30).distanceMax(160))
    .force('link', links)
    .force('bounds', confineDuringSettling ? () => {
      for (const node of activeNodes) {
        const position = confine(node, node.x + node.vx! * velocityFactor, node.y + node.vy! * velocityFactor)
        node.vx = (position.x - node.x) / velocityFactor
        node.vy = (position.y - node.y) / velocityFactor
      }
    } : null)
    .alphaDecay(0.032)
    .velocityDecay(velocityDecay)

  let lastChrome: readonly Rect[] | undefined
  let activeExchanges = new Map<string, readonly [number, number]>()

  function hullBounds(node: ReplayNode, chrome: readonly Rect[]): Rect {
    const insetX = Math.min(node.radius + 5, width / 2)
    const insetY = Math.min(node.radius + 5, height / 2)
    const ownSide = node.entity.side === order[0]
    const neutral = node.entity.side < 0
    const minX = split === 'x' && !ownSide && !neutral ? width * splitRatio + insetX : insetX
    const maxX = split === 'x' && ownSide ? width * splitRatio - insetX : width - insetX
    const headerFloor = chrome.length && spacingScale < 1 ? insetY : Math.min(height - insetY, top + insetY)
    const minY = neutral ? Math.min(height - insetY, height / 2 + 1)
      : split === 'y' && !ownSide ? Math.max(headerFloor, verticalDivider + insetY) : headerFloor
    const maxY = split === 'y' && ownSide ? Math.min(height - insetY, verticalDivider - insetY) : height - insetY
    return { x: Math.min(minX, maxX), y: Math.min(minY, maxY), width: Math.max(0, maxX - minX), height: Math.max(0, maxY - minY) }
  }

  function placeVisible(visible: ReadonlySet<EntityKey>, live: readonly ReplayEdge[], chrome: readonly Rect[] = []) {
    const next = assigned.filter(({ entity }) => visible.has(entity.key))
    const unchanged = next.length === activeNodes.length && next.every((node, index) => node === activeNodes[index])
    const exchanges = new Map<string, readonly [number, number]>()
    for (const { from, to } of live) {
      const source = byKey.get(from)
      const target = byKey.get(to)
      if (!source || !target || !visible.has(from) || !visible.has(to)) continue
      const a = source.entity.side
      const b = target.entity.side
      if (a >= 0 && b >= 0 && a !== b) exchanges.set(a < b ? `${a}/${b}` : `${b}/${a}`, [a, b])
    }
    const exchangeStarted = [...exchanges.keys()].some((pair) => !activeExchanges.has(pair))
    activeExchanges = exchanges
    const chromeChanged = chrome !== lastChrome && (!lastChrome || chrome.length !== lastChrome.length || chrome.some((rect, index) => {
      const prior = lastChrome![index]!
      return rect.x !== prior.x || rect.y !== prior.y || rect.width !== prior.width || rect.height !== prior.height
    }))
    lastChrome = chrome
    const seated = placeUnassigned(visible, chrome, chromeChanged)
    if (unchanged && !exchangeStarted && !chromeChanged && !seated) return false

    const survivors = new Set(activeNodes)
    // The first batch after an analysis rebuild keeps coordinates from the previous scene.
    if (!activeNodes.length) for (const node of next) if (placed.has(node.entity.key)) survivors.add(node)
    activeNodes = next
    const settling = next.filter((node) => !survivors.has(node) || exchangeStarted && unchanged)
    const pinned = next.filter((node) => !settling.includes(node))
    if (settling.length) {
      links.links([])
      simulation.nodes(next)
      for (const node of pinned) {
        node.fx = node.x
        node.fy = node.y
      }
      for (const node of settling) {
        if (confineDuringSettling) Object.assign(node, confine(node, node.x, node.y))
        node.vx = node.vy = 0
      }

      const pairs = new Map<string, CombatLink>()
      for (const { from, to } of live) {
        if (from === to || !visible.has(from) || !visible.has(to)) continue
        const source = byKey.get(from)
        const target = byKey.get(to)
        if (!source || !target || source.entity.side < 0 || target.entity.side < 0) continue
        const key = `${source.ordinal}/${target.ordinal}`
        const pair = pairs.get(key)
        if (pair) pair.count++
        else pairs.set(key, { source, target, count: 1 })
      }
      links.links([...pairs.values()])
      // Settle synchronously once as pilots arrive or a new exchange starts.
      simulation.alpha(0.2).tick(pinned.length ? 70 : 145).alpha(0)
      for (const node of pinned) node.fx = node.fy = null
      const approach = formationApproach(exchanges.values())
      for (const node of settling) {
        const offset = approach.get(node.entity.side)
        Object.assign(node, confine(node, node.x + (offset?.x ?? 0), node.y + (offset?.y ?? 0)))
      }
    }

    const occupied = unassigned.filter(({ entity }) => visible.has(entity.key))
    let repositioned = false
    for (const node of [...pinned, ...settling]) {
      const point = findHullCenter(node, node.radius, hullBounds(node, chrome), occupied, chrome)
      if (point.x !== node.x || point.y !== node.y) repositioned = true
      Object.assign(node, { x: point.x, y: point.y, vx: 0, vy: 0 })
      occupied.push(node)
      placed.add(node.entity.key)
    }
    return !unchanged || exchangeStarted || repositioned || seated
  }

  const rowWidth = Math.max(0, width - 12)
  const seatRadius = Math.max(0, ...unassigned.map(({ radius }) => radius + 2))
  const slotSize = seatRadius * 2 + 6
  const columns = Math.max(1, Math.floor(rowWidth / slotSize))
  const row = { seats: new Map<EntityKey, number>(), slots: columns }

  function inheritPositions(previous: LayoutPositions) {
    let ordinal = 1 + Math.max(-1, ...Array.from(previous.byKey.values(), (node) => node.ordinal))
    for (const node of nodes) {
      const prior = previous.byKey.get(node.entity.key)
      node.ordinal = prior?.ordinal ?? ordinal++
      if (prior && (split ? prior.entity.side === node.entity.side : (prior.entity.side === -1) === (node.entity.side === -1))) {
        node.x = prior.x
        node.y = prior.y
        if (previous.placed.has(node.entity.key)) placed.add(node.entity.key)
      }
    }
    row.slots = previous.row.slots
    for (const [key, seat] of previous.row.seats) {
      if (byKey.get(key)?.entity.side === -1) row.seats.set(key, seat)
    }
  }

  function placeUnassigned(visible: ReadonlySet<EntityKey>, chrome: readonly Rect[], chromeChanged: boolean) {
    const seated = unassigned.filter(({ entity }) => visible.has(entity.key))
    const { seats } = row
    for (const key of seats.keys()) if (!visible.has(key)) seats.delete(key)
    if (!seated.length) {
      row.slots = columns
      return false
    }
    row.slots = Math.max(row.slots, Math.ceil(seated.length / columns) * columns)
    const newcomers = seated.filter(({ entity }) => !seats.has(entity.key))
    if (newcomers.length) {
      const taken = new Set(seats.values())
      const center = (columns - 1) / 2
      const free = Array.from({ length: row.slots }, (_, slot) => slot)
        .filter((slot) => !taken.has(slot))
        .sort((a, b) => Math.floor(a / columns) - Math.floor(b / columns)
          || Math.abs(a % columns - center) - Math.abs(b % columns - center))
        .slice(0, newcomers.length)
        .sort((a, b) => a - b)
      newcomers.forEach(({ entity }, index) => seats.set(entity.key, free[index]!))
    }

    if (!newcomers.length && !chromeChanged) return false
    const step = rowWidth / columns
    const occupied: ReplayNode[] = []
    for (const node of seated) {
      const seat = seats.get(node.entity.key)!
      const target = {
        x: (width - rowWidth) / 2 + (seat % columns + 0.5) * step,
        y: height - Math.max(seatRadius + 3, 25 * spacingScale) - Math.floor(seat / columns) * slotSize,
      }
      Object.assign(node, findHullCenter(target, node.radius, hullBounds(node, chrome), occupied, chrome))
      occupied.push(node)
    }
    return true
  }

  return { nodes, byKey, row, placed, width, height, topInset, split, ours: order[0], anchorOrder, placeVisible, inheritPositions }
}

export type ReplayLayout = ReturnType<typeof makeLayout>
