import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import type { Analysis, Entity, EntityKey, Interaction, Killmail } from '@/core/contract'
import shipTypes from '@/core/data/ship-types.json'
import { sideColor, sideLetter } from '@/app/lib/sides'
import { interactionScales, sideAnchors } from './layout-effects'
import { compactHullSeats, shortMapHeight, type Rect } from './placement'
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
  const shortMap = height < shortMapHeight
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
    .distance(({ source, target }) => source.entity.side === target.entity.side ? 70 : Math.min(width * 0.5, 420))
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

  let compactChrome: readonly Rect[] | undefined
  function placeCompact(next: ReplayNode[], chrome: readonly Rect[]) {
    compactChrome = chrome
    activeNodes = next
    if (!next.length) return true
    const radius = Math.max(...next.map((node) => node.radius + 2))
    const seats = compactHullSeats(width, height, radius, next.length, chrome)
    const free = new Set(seats)
    const entrants = next.filter((node) => {
      if (!placed.has(node.entity.key)) return true
      const retained = seats.find((seat) => seat.x === node.x && seat.y === node.y)
      return !retained || !free.delete(retained)
    })
    for (const node of entrants) {
      const anchor = anchorFor(node)
      let nearest = seats[0]!
      let distance = Infinity
      for (const seat of free) {
        const score = (seat.x - anchor.x) ** 2 + (seat.y - anchor.y) ** 2
        if (score >= distance) continue
        nearest = seat
        distance = score
      }
      free.delete(nearest)
      Object.assign(node, nearest)
      placed.add(node.entity.key)
    }
    return true
  }

  function clearCoveredCenter(node: ReplayNode) {
    const neighbors = activeNodes.filter((other) => other !== node)
    const coversCenter = neighbors.some((other) => Math.hypot(node.x - other.x, node.y - other.y)
      < Math.max(node.radius, other.radius) + 2)
    if (!coversCenter) return
    // The final boundary clamp can put two hulls together. Move only the entrant whose center is affected.
    for (let distance = 4; distance <= 32; distance += 4) {
      for (let direction = 0; direction < 8; direction++) {
        const angle = direction * Math.PI / 4
        const point = confine(node, node.x + Math.cos(angle) * distance, node.y + Math.sin(angle) * distance)
        if (neighbors.some((other) => Math.hypot(point.x - other.x, point.y - other.y) < node.radius + other.radius + 4)) continue
        Object.assign(node, point)
        return
      }
    }
  }

  function placeVisible(visible: ReadonlySet<EntityKey>, live: readonly ReplayEdge[], chrome: readonly Rect[] = []) {
    const next = (shortMap ? nodes : assigned).filter(({ entity }) => visible.has(entity.key))
    const unchanged = next.length === activeNodes.length && next.every((node, index) => node === activeNodes[index])
    if (shortMap) return (!unchanged || chrome !== compactChrome) && placeCompact(next, chrome)
    if (unchanged) return false

    const survivors = new Set(activeNodes)
    // The first batch after an analysis rebuild keeps coordinates from the previous scene.
    if (!activeNodes.length) for (const node of next) if (placed.has(node.entity.key)) survivors.add(node)
    const entrants = next.filter((node) => !survivors.has(node))
    activeNodes = next
    if (!entrants.length) return true

    links.links([])
    simulation.nodes(next)
    const pinned = next.filter((node) => survivors.has(node))
    for (const node of pinned) {
      node.fx = node.x
      node.fy = node.y
    }
    for (const node of entrants) {
      if (confineDuringSettling) Object.assign(node, confine(node, node.x, node.y))
      node.vx = node.vy = 0
    }

    const pairs = new Map<string, CombatLink>()
    for (const { from, to } of live) {
      if (from === to || !visible.has(from) || !visible.has(to)) continue
      const source = byKey.get(from)
      const target = byKey.get(to)
      if (!source || !target || source.entity.side === -1 || target.entity.side === -1) continue
      const key = `${source.ordinal}/${target.ordinal}`
      const pair = pairs.get(key)
      if (pair) pair.count++
      else pairs.set(key, { source, target, count: 1 })
    }
    links.links([...pairs.values()])
    // Settle only the entering nodes, in one batch. Per-frame simulation drift is visible even while paused.
    simulation.alpha(0.2).tick(pinned.length ? 70 : 145).alpha(0)
    for (const node of pinned) node.fx = node.fy = null
    for (const node of entrants) {
      Object.assign(node, confine(node, node.x, node.y))
      node.vx = node.vy = 0
      placed.add(node.entity.key)
    }
    if (!split) for (const node of entrants) clearCoveredCenter(node)
    return true
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

  function placeUnassigned(visible: ReadonlySet<EntityKey>) {
    if (shortMap) return
    const seated = unassigned.filter(({ entity }) => visible.has(entity.key))
    const { seats } = row
    for (const key of seats.keys()) if (!visible.has(key)) seats.delete(key)
    if (!seated.length) {
      row.slots = columns
      return
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

    const step = rowWidth / columns
    for (const node of seated) {
      const seat = seats.get(node.entity.key)!
      node.x = (width - rowWidth) / 2 + (seat % columns + 0.5) * step
      node.y = Math.max(seatRadius, height - Math.max(seatRadius + 3, 25 * spacingScale) - Math.floor(seat / columns) * slotSize)
    }
  }

  return { nodes, byKey, row, placed, width, height, topInset, split, shortMap, ours: order[0], anchorOrder, placeVisible, placeUnassigned, inheritPositions }
}

export type ReplayLayout = ReturnType<typeof makeLayout>
