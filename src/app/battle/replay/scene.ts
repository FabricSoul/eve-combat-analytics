import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import type { Analysis, Entity, EntityKey, Interaction, Killmail } from '@/core/contract'
import shipTypes from '@/core/data/ship-types.json'
import { sideColor, sideLetter } from '@/app/lib/sides'
import { interactionScales, sideAnchors } from './layout-effects'
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
  const anchors = sideAnchors(order, width, height)
  const compact = height < 420
  // Match the compact controls breakpoint. Use the longer axis for the two fleets.
  const split: 'x' | 'y' | null = width <= 430 && order.length === 2 ? (width >= height ? 'x' : 'y') : null
  // Give the fleet with more required names a little extra space.
  const logBalance = split ? pilots.reduce((balance, { entity }) => !entity.hasLog ? balance
    : balance + (entity.side === order[0] ? 1 : entity.side === order[1] ? -1 : 0), 0) : 0
  const splitRatio = 0.5 + Math.sign(logBalance) * 0.05
  const compactTop = 57
  // Allocate more of the space lost to wrapped controls to the fleet with fewer names.
  const upperFleetShare = 0.5 + Math.sign(logBalance) * 0.35
  const verticalDivider = height * splitRatio + Math.max(0, topInset - compactTop) * upperFleetShare
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
    return {
      ...pilot,
      ordinal: index,
      x: anchor.x + Math.cos(angle) * spread,
      y: anchor.y + Math.sin(angle) * spread,
      radius: hasLog ? (split ? 9 : compact ? 12 : 15) : pilot.primaryEnemy ? (compact ? 11 : 13) : (split ? 6 : compact ? 8 : 9),
      labeled: hasLog || (!compact && pilot.primaryEnemy),
    }
  })
  const byKey = new Map(nodes.map((node) => [node.entity.key, node]))
  const assigned = nodes.filter(({ entity }) => entity.side !== -1)
  let activeNodes: ReplayNode[] = []
  const placed = new Set<EntityKey>()
  const unassigned = nodes.filter(({ entity }) => entity.side === -1).map((node) => ({ node, radius: node.radius }))
  const bottomInset = unassigned.length ? 41 : 0
  const anchorFor = ({ entity }: ReplayNode) => anchors.get(entity.side) ?? anchors.get(-1)!

  function confine(node: ReplayNode, x: number, y: number) {
    const inset = node.radius + 5
    const ours = node.entity.side === order[0]
    const minX = split === 'x' && !ours ? width * splitRatio + inset : inset
    const maxX = split === 'x' && ours ? width * splitRatio - inset : width - inset
    const top = split === 'y' && !ours ? verticalDivider : split ? compactTop : 42
    const minY = Math.max(top, topInset) + inset
    const floor = height - inset - Math.max(bottomInset, node.labeled ? 20 : 8)
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
    .force('collide', forceCollide<ReplayNode>(({ radius, labeled, entity }) => radius + (split ? (entity.hasLog ? 6 : smallShipMargin) : labeled ? 26 : 8)).strength(0.9))
    .force('charge', forceManyBody().strength(split ? -80 : -30).distanceMax(160))
    .force('link', links)
    .force('bounds', split ? () => {
      for (const node of activeNodes) {
        const position = confine(node, node.x + node.vx! * velocityFactor, node.y + node.vy! * velocityFactor)
        node.vx = (position.x - node.x) / velocityFactor
        node.vy = (position.y - node.y) / velocityFactor
      }
    } : null)
    .alphaDecay(0.032)
    .velocityDecay(velocityDecay)

  function placeVisible(visible: ReadonlySet<EntityKey>, live: readonly ReplayEdge[]) {
    const next = assigned.filter(({ entity }) => visible.has(entity.key))
    if (next.length === activeNodes.length && next.every((node, index) => node === activeNodes[index])) return false

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
      if (split) Object.assign(node, confine(node, node.x, node.y))
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
    return true
  }

  const rowWidth = Math.max(0, width - 12)
  const slotSize = 2 * Math.max(0, ...unassigned.map(({ radius }) => radius)) + 10
  const defaultSlots = Math.max(1, Math.floor(rowWidth / slotSize))
  const row = { seats: new Map<EntityKey, number>(), slots: defaultSlots }

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
    const seated = unassigned.filter(({ node }) => visible.has(node.entity.key))
    const { seats } = row
    for (const key of seats.keys()) if (!visible.has(key)) seats.delete(key)
    if (!seated.length) {
      row.slots = defaultSlots
      return
    }
    // Each occupied center becomes the middle of three finer slots, so it does not move.
    while (seated.length > row.slots) {
      row.slots *= 3
      for (const [key, slot] of seats) seats.set(key, 3 * slot + 1)
    }
    const slots = row.slots
    const newcomers = seated.filter(({ node }) => !seats.has(node.entity.key))
    if (newcomers.length) {
      const taken = new Set(seats.values())
      const center = (slots - 1) / 2
      const free = Array.from({ length: slots }, (_, slot) => slot)
        .filter((slot) => !taken.has(slot))
        .sort((a, b) => Math.abs(a - center) - Math.abs(b - center))
        .slice(0, newcomers.length)
        .sort((a, b) => a - b)
      newcomers.forEach(({ node }, index) => seats.set(node.entity.key, free[index]!))
    }

    const step = rowWidth / slots
    const scale = Math.min(1, step / slotSize)
    for (const { node, radius } of seated) {
      node.radius = Math.max(0, (radius + 2) * scale - 2)
      node.x = (width - rowWidth) / 2 + (seats.get(node.entity.key)! + 0.5) * step
      node.y = height - 25
    }
  }

  return { nodes, byKey, row, placed, width, height, topInset, split, ours: order[0], placeVisible, placeUnassigned, inheritPositions }
}

export type ReplayLayout = ReturnType<typeof makeLayout>
