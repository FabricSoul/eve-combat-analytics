import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from 'd3-force'
import type { SimulationLinkDatum, SimulationNodeDatum } from 'd3-force'
import type { Analysis, Entity, EntityKey, Interaction, Killmail } from '@/core/contract'
import shipTypes from '@/core/data/ship-types.json'
import { sideColor, sideLetter } from '@/app/lib/sides'
import { interactionScales, sideAnchors, upperTimeIndex } from './layout-effects'

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
  const entities = Object.values(analysis.entities).filter((entity) => entity.hasLog || active.has(entity.key))
  const primaryEnemies = new Set(entities
    .filter(({ side }) => side >= 0 && side !== order[0])
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
  const pilotKeys = new Set(pilots.map(({ entity }) => entity.key))
  const pointSpans = analysis.ewarSpans.filter(({ ewar }) => ewar === 'warp_disrupt' || ewar === 'warp_scramble')
  return { pilots, pilotKeys, pilot, edges, pointSpans }
}

interface CombatLink extends SimulationLinkDatum<ReplayNode> {
  source: ReplayNode
  target: ReplayNode
  count: number
}

export function makeLayout(pilots: readonly ReplayPilot[], order: readonly number[], width: number, height: number) {
  const anchors = sideAnchors(order, width, height)
  const compact = height < 420
  const nodes = pilots.map((pilot, index): ReplayNode => {
    const { hasLog, side } = pilot.entity
    const anchor = anchors.get(side) ?? anchors.get(-1)!
    const angle = index * Math.PI * (3 - Math.sqrt(5))
    const spread = Math.sqrt(index + 1) * 7
    return {
      ...pilot,
      x: anchor.x + Math.cos(angle) * spread,
      y: anchor.y + Math.sin(angle) * spread,
      radius: hasLog ? (compact ? 12 : 15) : pilot.primaryEnemy ? (compact ? 11 : 13) : (compact ? 8 : 9),
      labeled: !compact && (hasLog || pilot.primaryEnemy),
    }
  })
  const byKey = new Map(nodes.map((node) => [node.entity.key, node]))
  const anchorFor = ({ entity }: ReplayNode) => anchors.get(entity.side) ?? anchors.get(-1)!
  const links = forceLink<ReplayNode, CombatLink>()
    .distance(({ source, target }) => source.entity.side === target.entity.side ? 70 : Math.min(width * 0.5, 420))
    .strength(({ count }) => Math.min(0.12, 0.02 * count))
  const simulation = forceSimulation(nodes).stop()
    .force('x', forceX<ReplayNode>((node) => anchorFor(node).x).strength(0.09))
    .force('y', forceY<ReplayNode>((node) => anchorFor(node).y).strength((node) => (
      order.length < 3 && node.entity.side !== -1 ? 0.025 : 0.10
    )))
    .force('collide', forceCollide<ReplayNode>(({ radius, labeled }) => radius + (labeled ? 26 : 8)).strength(0.9))
    .force('charge', forceManyBody().strength(-30).distanceMax(160))
    .force('link', links)
    .alphaDecay(0.032)
    .velocityDecay(0.35)

  function tick(count = 1) {
    simulation.tick(count)
    for (const node of nodes) {
      const inset = node.radius + 5
      node.x = Math.max(inset, Math.min(width - inset, node.x))
      node.y = Math.max(42 + inset, Math.min(height - inset - (node.labeled ? 20 : 8), node.y))
    }
  }

  function engage(edges: readonly ReplayEdge[], now: number, selected: EntityKey | null, focusOnly: boolean) {
    const pairs = new Map<string, CombatLink>()
    const end = upperTimeIndex(edges, now)
    for (let index = upperTimeIndex(edges, now - 4000); index < end; index++) {
      const { from, to } = edges[index]!
      if (from === to || (focusOnly && from !== selected && to !== selected)) continue
      const source = byKey.get(from)
      const target = byKey.get(to)
      if (!source || !target) continue
      const key = `${source.index}/${target.index}`
      const pair = pairs.get(key)
      if (pair) pair.count++
      else pairs.set(key, { source, target, count: 1 })
    }
    links.links([...pairs.values()])
    simulation.alpha(Math.max(simulation.alpha(), 0.2))
  }

  tick(145)
  return { nodes, byKey, tick, engage, isMoving: () => simulation.alpha() > 0.004 }
}

export type ReplayLayout = ReturnType<typeof makeLayout>
