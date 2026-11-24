import type { EntityKey, EwarSpan, HitQuality } from '@/core/contract'
import { fmtNum } from '@/app/lib/format'
import { typeIconUrl } from '@/app/lib/images'
import { initialCamera, projectPoint } from './camera'
import { impactShake, interactionWindow } from './layout-effects'
import type { Point } from './layout-effects'
import { hitTracerStyle } from './hit-quality'
import {
  createProjectilePlayback, isProjectile, maxProjectileTravelMs, projectileAt, projectilePerPair, projectileTravelMs, shotTravelMs,
  type Flight, type ProjectilePlayback,
} from './projectile'
import { placeAnnotation } from './placement'
import type { Rect } from './placement'
import type { ReplayEdge, ReplayLayout, ReplayNode } from './scene'

export type ReplaySample = { quality: HitQuality } | 'damage' | 'miss' | 'repair' | 'neut' | 'point' | 'kill' | 'shake'

export interface ReplayFrame {
  t: number
  selected: EntityKey | null
  focusOnly: boolean
  reducedMotion: boolean
  playing: boolean
  pausedElapsed?: number
}

interface Line {
  edge: ReplayEdge
  source: Point & { color: string }
  target: Point & { radius: number }
  age: number
  travel: number
  lifetime: number
  opacity: number
  color: string
  style: ReturnType<typeof hitTracerStyle>
}

export interface MissTracer {
  source: Point
  stop: Point
}

export interface PaintedModule {
  name: string
  rect: Rect
}

export function missedTracerAt(misses: readonly MissTracer[], point: Point) {
  return misses.some(({ source, stop }) => {
    const dx = stop.x - source.x
    const dy = stop.y - source.y
    const length = dx * dx + dy * dy
    const progress = length ? ((point.x - source.x) * dx + (point.y - source.y) * dy) / length : 0
    const fraction = Math.max(0, Math.min(1, progress))
    const x = source.x + fraction * dx - point.x
    const y = source.y + fraction * dy - point.y
    return x * x + y * y <= 36
  })
}

interface Impact {
  edge: ReplayEdge
  age: number
  opacity: number
  color: string
}

const tau = 2 * Math.PI

export function makePainter(
  under: CanvasRenderingContext2D, over: CanvasRenderingContext2D, host: HTMLElement, invalidate: () => void,
  playback: ProjectilePlayback = createProjectilePlayback(),
) {
  const colors = new Map<string, string>()
  const icons = new Map<string, HTMLImageElement | null | undefined>()
  let mono = ''
  let fade = 3000
  let linger = fade - maxProjectileTravelMs
  let appear = 200

  function refreshTokens() {
    const style = getComputedStyle(host)
    for (const name of ['side-0', 'side-1', 'side-2', 'side-n', 'repair', 'text', 'text-2', 'text-3', 'accent-line', 'bg', 'raised', 'surface', 'dead']) {
      colors.set(`var(--color-${name})`, style.getPropertyValue(`--color-${name}`).trim())
    }
    mono = style.getPropertyValue('--font-mono').trim()
    const milliseconds = (name: string, fallback: number) => {
      const css = style.getPropertyValue(name).trim()
      const value = parseFloat(css)
      return value > 0 ? value * (css.endsWith('ms') ? 1 : 1000) : fallback
    }
    fade = milliseconds('--dur-edge-fade', 3000)
    linger = Math.max(250, fade - maxProjectileTravelMs)
    appear = milliseconds('--dur-edge-in', 200)
  }

  const color = (name: string) => colors.get(`var(--color-${name})`) ?? ''
  const edgeColor = (edge: ReplayEdge, source: Pick<ReplayNode, 'color'>, sideShare: number) => {
    if (edge.kind === 'damage' || edge.kind === 'miss') {
      const side = colors.get(source.color) || color('side-n')
      return sideShare === 100 ? side : `color-mix(in srgb, ${side} ${sideShare}%, ${color('surface')})`
    }
    if (edge.kind === 'repair') return color('repair')
    return color('text-3')
  }

  function moduleIcon(name: string) {
    if (icons.has(name)) return icons.get(name)
    icons.set(name, undefined)
    const remember = (icon: HTMLImageElement | null) => {
      icons.set(name, icon)
      invalidate()
    }
    void import('@/core/data/item-types').then(({ itemTypeId }) => {
      const id = itemTypeId(name)
      if (id === null) {
        remember(null)
        return
      }
      const img = new Image(18, 18)
      img.onload = () => remember(img)
      img.onerror = () => remember(null)
      img.src = typeIconUrl(id, 18)
    }).catch(() => remember(null))
    return undefined
  }

  function ring(
    ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, stroke: string,
    width: number, opacity: number, angles: [number, number] = [0, tau],
  ) {
    ctx.beginPath()
    ctx.arc(x, y, radius, ...angles)
    ctx.lineWidth = width
    ctx.strokeStyle = stroke
    ctx.globalAlpha = opacity
    ctx.stroke()
  }

  function strokeLine(line: Line, source: Point, target: Point, from: number, to: number, opacity: number, width: number) {
    const { kind, strength } = line.edge
    const { x, y } = source
    const dx = target.x - x
    const dy = target.y - y
    under.beginPath()
    under.moveTo(x + dx * from, y + dy * from)
    if (kind === 'neut' || kind === 'nos') {
      const distance = Math.hypot(dx, dy) || 1
      for (let index = 1; index < 8; index++) {
        const u = from + (to - from) * index / 8
        const bend = (index % 2 ? 1 : -1) * (2 + 3 * strength)
        under.lineTo(x + dx * u - dy * bend / distance, y + dy * u + dx * bend / distance)
      }
    }
    under.lineTo(x + dx * to, y + dy * to)
    under.setLineDash(line.style.dash)
    under.lineWidth = width
    under.lineCap = 'round'
    under.strokeStyle = line.color
    under.globalAlpha = opacity
    under.stroke()
    under.setLineDash([])
  }

  function missEnd(source: Point, target: Point, radius: number, limit: number) {
    const distance = Math.hypot(target.x - source.x, target.y - source.y) || 1
    return Math.max(0, Math.min(limit, 1 - (radius + 7) / distance))
  }

  function pathEnd(line: Line, source: Point, target: Point) {
    return line.edge.kind === 'miss' ? missEnd(source, target, line.target.radius, line.style.end) : line.style.end
  }

  function drawLine(line: Line, source: Point, target: Point, end: number, reducedMotion: boolean, pausedElapsed: number, frozen = false) {
    if (!end) return
    const { edge, opacity, age, travel, lifetime, style } = line
    const width = edge.amount > 0 || edge.kind === 'miss' ? style.width : 1.25
    const entrance = reducedMotion ? 1 : Math.min(1, 0.18 + age / appear)
    const remaining = Math.max(0, 1 - age / lifetime)
    const trailAlpha = reducedMotion ? 0.42 : remaining * entrance * 0.24
    if (edge.kind === 'miss') {
      strokeLine(line, source, target, 0, end, opacity * Math.max(trailAlpha, remaining * 0.65), width)
      const stop = { x: source.x + (target.x - source.x) * end, y: source.y + (target.y - source.y) * end }
      return { source, stop, color: line.color, opacity: opacity * remaining }
    }
    if (frozen) {
      if (age > 0) strokeLine(line, source, target, 0, age / travel, opacity * entrance, width)
      return
    }
    strokeLine(line, source, target, 0, end, opacity * trailAlpha, 0.6 + width * 0.35)

    const effectAge = age + pausedElapsed
    const progress = effectAge / travel
    if (!reducedMotion && effectAge < lifetime && progress < 1 && opacity > 0.2) {
      const from = Math.max(0, progress - 0.35)
      const capDrain = edge.kind === 'neut' || edge.kind === 'nos'
      strokeLine(line, source, target, capDrain ? 1 - progress : from, capDrain ? 1 - from : progress, opacity * entrance, width)
    }
  }

  function drawMissMark({ stop: { x, y }, color: tone, opacity }: MissTracer & { color: string; opacity: number }) {
    const arm = 4
    over.beginPath()
    over.moveTo(x - arm, y - arm)
    over.lineTo(x + arm, y + arm)
    over.moveTo(x + arm, y - arm)
    over.lineTo(x - arm, y + arm)
    over.strokeStyle = tone
    over.lineCap = 'round'
    over.lineWidth = 1.75
    over.globalAlpha = opacity
    over.stroke()
  }

  function drawProjectile(
    line: Line, source: Point, target: Point, end: number, reducedMotion: boolean, elapsed: number, sample = false,
  ): Rect | null {
    const { edge, age, opacity, travel, lifetime } = line
    const effectAge = age + (reducedMotion ? 0 : elapsed)
    if (!end || effectAge >= lifetime || opacity < 0.25) return null
    if (edge.kind === 'miss' && (reducedMotion || effectAge >= travel)) return null
    const { position: { x, y }, head, continuous } = projectileAt(edge.kind, source, target, effectAge, reducedMotion, end, travel)
    const icon = !sample && edge.weapon ? moduleIcon(edge.weapon) : null
    const inFlight = !continuous && effectAge < travel
    const alpha = opacity * (reducedMotion ? 0.9 : Math.min(1, (1 - effectAge / lifetime) * 1.35))
    if (!reducedMotion && (inFlight || !icon)) {
      const lead = Math.min(end, head + 0.035)
      over.beginPath()
      over.arc(source.x + (target.x - source.x) * lead, source.y + (target.y - source.y) * lead, icon ? 2 : 2.5, 0, tau)
      over.globalAlpha = alpha
      over.fillStyle = line.color
      over.fill()
    }
    if (!sample && !edge.weapon) return null

    over.globalAlpha = alpha
    if (icon) {
      over.drawImage(icon, x - 9, y - 9, 18, 18)
      return { x: x - 9, y: y - 9, width: 18, height: 18 }
    }
    const radius = 5
    over.beginPath()
    over.moveTo(x, y - radius)
    over.lineTo(x + radius, y)
    over.lineTo(x, y + radius)
    over.lineTo(x - radius, y)
    over.lineTo(x, y - radius)
    over.fillStyle = color('surface')
    over.fill()
    over.lineWidth = 1.5
    over.strokeStyle = line.color
    over.stroke()
    return { x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 }
  }

  function drawImpact(
    { x, y }: Point, radius: number, impact: Impact, numberOffset: number, bounds: Rect, occupied: Rect[],
  ) {
    const { edge, age, opacity, color: tone } = impact
    const { strength, amount, kind } = edge
    const progress = age / 780
    if (kind === 'neut' || kind === 'nos') {
      if (progress < 1) ring(under, x, y, radius + 2 + (1 - progress) * (8 + 9 * strength), tone, 2, opacity * (1 - progress))
      return
    }
    if (progress < 1) {
      ring(under, x, y, radius + 3 + progress * (7 + 14 * strength), tone, 1.5 + strength, opacity * (1 - progress))
      if (kind === 'repair' && edge.repairType === 'shield') {
        ring(under, x, y, radius + 5 + progress * (11 + 16 * strength), tone, 1, opacity * (1 - progress))
      }
    }
    const textProgress = age / (700 + 500 * strength)
    if (textProgress >= 1 || amount === 0) return
    const fontSize = 11 + 6 * strength
    over.globalAlpha = opacity * (1 - textProgress)
    over.font = `500 ${fontSize}px ${mono}`
    over.textAlign = 'right'
    over.textBaseline = 'top'
    over.strokeStyle = color('bg')
    over.fillStyle = color('text')
    over.lineWidth = 3
    const value = `${kind === 'repair' ? '+' : '−'}${fmtNum(Math.round(amount))}`
    const size = { width: over.measureText(value).width, height: fontSize }
    const above = y - radius - numberOffset - size.height - 17 * textProgress
    const rect = placeAnnotation([
      { ...size, x: x + radius + 4, y: above },
      { ...size, x: x - radius - size.width - 4, y: above },
      { ...size, x: x - size.width / 2, y: Math.min(above, y - radius - size.height - 5) },
      { ...size, x: x + radius + 7, y: y - size.height / 2 },
      { ...size, x: x - size.width / 2, y: y + radius + 5 },
    ], bounds, occupied, true)
    if (!rect) return
    over.strokeText(value, rect.x + rect.width, rect.y)
    over.fillText(value, rect.x + rect.width, rect.y)
    occupied.push(rect)
  }

  function drawPoint(position: Point, radius: number, opacity: number, age: number) {
    const angle = (age % 2400) / 2400 * tau
    under.setLineDash([3, 4])
    ring(under, position.x, position.y, radius + 7, color('text'), 1.5, opacity, [angle, angle + tau])
    under.setLineDash([])
  }

  function hitOffset(age: number, ordinal: number, shake: number) {
    const phase = (age % 1000) * 0.24 + ordinal
    return { x: Math.sin(phase) * shake, y: Math.cos(phase * 1.3) * shake }
  }

  function burst({ x, y }: Point, radius: number, age: number) {
    if (age >= Math.min(fade, 920)) return false
    for (let index = 0; index < 3; index++) {
      const progress = (age - index * 110) / 700
      if (progress < 0 || progress >= 1) continue
      const growth = 1 - (1 - progress) ** 3
      ring(over, x, y, radius + (26 + index * 10) * growth,
        color(index === 1 ? 'accent-line' : 'text'), 3 - index * 0.75, 1 - progress)
    }
    return true
  }

  function liveEdges(edges: readonly ReplayEdge[], t: number) {
    const [start, end] = interactionWindow(edges, t, fade)
    return edges.slice(start, end)
  }

  function paint(
    layout: ReplayLayout, live: readonly ReplayEdge[], pointSpans: readonly EwarSpan[],
    present: ReadonlySet<EntityKey>, frame: ReplayFrame, width: number, height: number, camera = initialCamera,
  ) {
    under.clearRect(0, 0, width, height)
    over.clearRect(0, 0, width, height)
    const { t, selected, focusOnly, playing, reducedMotion, pausedElapsed = 0 } = frame
    const pausedShot = ({ edge, age, travel }: Line) => !playing && !reducedMotion && age < travel
      && (edge.kind === 'damage' || edge.kind === 'repair')
    let animating = false
    const related = new Set<EntityKey>()
    const lines = new Map<string, Line & { source: ReplayNode; target: ReplayNode }>()
    const impacts = new Map<ReplayNode, Map<ReplayEdge['kind'], Impact>>()
    const shakes = new Map<ReplayNode, number>()
    const points = new Map<ReplayNode, number>()
    const trackedEndpoints = focusOnly ? playback.endpoints(t, playing) : null
    const flights = playback.advance(live, t, playing, linger, (edge) => {
      if (edge.from === edge.to || !present.has(edge.from) || !present.has(edge.to)) return null
      if (focusOnly && edge.from !== selected && edge.to !== selected) return null
      const sourceNode = layout.byKey.get(edge.from)
      const targetNode = layout.byKey.get(edge.to)
      if (!sourceNode || !targetNode) return null
      const source = projectPoint(camera, sourceNode)
      const target = projectPoint(camera, targetNode)
      if (edge.kind !== 'miss') return projectileTravelMs(source, target)
      const fraction = missEnd(source, target, targetNode.radius, hitTracerStyle('miss', null, 0).end)
      return projectileTravelMs(source, { x: source.x + (target.x - source.x) * fraction,
        y: source.y + (target.y - source.y) * fraction })
    })
    const shotLines: { flight: Flight; line: Line & { source: ReplayNode; target: ReplayNode } }[] = []

    function addLine(edge: ReplayEdge, age: number, travel: number, lifetime: number, inFlight = false) {
      if (!present.has(edge.from) || !present.has(edge.to)) return
      const source = layout.byKey.get(edge.from)
      const target = layout.byKey.get(edge.to)
      if (!source || !target) return
      const highlighted = selected === edge.from || selected === edge.to
      if (focusOnly && !highlighted && !inFlight) return
      if (highlighted) {
        related.add(edge.from)
        related.add(edge.to)
      }
      const opacity = selected === null || highlighted ? 1 : inFlight ? 0.45 : 0.15
      const style = hitTracerStyle(edge.kind, edge.quality, edge.strength)
      const tone = edgeColor(edge, source, style.sideShare)
      const line = { edge, source, target, age, travel, lifetime, opacity, color: tone, style }
      const key = `${source.ordinal}:${target.ordinal}:${edge.kind}`
      const previous = lines.get(key)
      // Coalesce coincident trails only. Each scheduled icon still has its own flight.
      if (!previous || age < previous.age || (previous.age === age && previous.edge.strength < edge.strength)) lines.set(key, line)
      const effectAge = age + pausedElapsed
      if (reducedMotion || effectAge >= lifetime || pausedShot(line)) return line
      if (!isProjectile(edge.kind) && source !== target && opacity > 0.2 && (effectAge < travel || edge.weapon)) animating = true
      if (edge.kind === 'miss') return line
      if (style.shakesTarget) {
        const shake = impactShake(edge.strength, effectAge - travel, false) * opacity
        if (shake > (shakes.get(target) ?? 0)) shakes.set(target, shake)
      }
      if (edge.kind === 'ewar' && (edge.ewar === 'warp_scramble' || edge.ewar === 'warp_disrupt')) {
        points.set(target, Math.max(points.get(target) ?? 0, opacity * (1 - effectAge / lifetime)))
        animating = true
      }
      const impactAge = effectAge - travel
      if (edge.amount > 0 && impactAge <= 1200 && (impactAge >= 0 || !isProjectile(edge.kind))) {
        animating = true
        if (impactAge >= 0) {
          const effects = impacts.get(target) ?? new Map<ReplayEdge['kind'], Impact>()
          const previousImpact = effects.get(edge.kind)
          if (!previousImpact || previousImpact.opacity <= opacity) {
            effects.set(edge.kind, { edge, age: impactAge, opacity, color: tone })
          }
          impacts.set(target, effects)
        }
      }
      return line
    }

    for (const edge of live) if (!isProjectile(edge.kind)) addLine(edge, t - edge.t, shotTravelMs, fade)
    for (const flight of flights) {
      if (t < flight.start) continue
      const travel = flight.end - flight.start
      const line = addLine(flight.edge, t - flight.start, travel, travel + linger, !flight.arrived)
      if (line && (!flight.arrived || reducedMotion)) shotLines.push({ flight, line })
    }

    for (const span of pointSpans) {
      if (span.start > t || span.end < t || !present.has(span.from) || !present.has(span.to)) continue
      const highlighted = selected === span.from || selected === span.to
      if (focusOnly && !highlighted) continue
      const target = layout.byKey.get(span.to)
      if (target && !reducedMotion) points.set(target, Math.max(points.get(target) ?? 0, selected === null || highlighted ? 1 : 0.15))
      if (highlighted) {
        related.add(span.from)
        related.add(span.to)
      }
    }

    // A single position per node anchors HTML markers and every painted effect for the frame.
    const positions = new Map<ReplayNode, Point>()
    const occupied: Rect[] = []
    const bounds = { x: 4, y: 32, width: Math.max(0, width - 8), height: Math.max(0, height - 36) }
    for (const node of layout.nodes) {
      const { key } = node.entity
      if (!present.has(key)) continue
      if (focusOnly && selected !== key && !related.has(key) && !trackedEndpoints?.has(key)) continue
      const shake = shakes.get(node) ?? 0
      const offset = hitOffset(t + pausedElapsed, node.ordinal, shake)
      const projected = projectPoint(camera, node)
      const x = projected.x + offset.x
      const y = projected.y + offset.y
      positions.set(node, { x, y })
      const inset = node.radius + 2
      occupied.push(
        { x: x - inset, y: y - inset, width: inset * 2 + (node.letter ? 7 : 0), height: inset * 2 },
        { x: x - node.radius - 6, y: y + node.radius - 12, width: 18, height: 18 },
      )
    }

    const misses: (MissTracer & { color: string; opacity: number })[] = []
    const projectiles: { from: string; to: string; age: number; line: Line; source: Point; target: Point; end: number }[] = []
    for (const line of lines.values()) {
      if (line.source === line.target) continue
      const source = positions.get(line.source)
      const target = positions.get(line.target)
      if (!source || !target) continue
      const end = pathEnd(line, source, target)
      const miss = drawLine(line, source, target, end, reducedMotion, pausedElapsed, pausedShot(line))
      if (miss) misses.push(miss)
      if (!isProjectile(line.edge.kind)) projectiles.push({ from: line.edge.from, to: line.edge.to, age: line.age, line, source, target, end })
    }
    const modules: PaintedModule[] = []
    function recordModule(rect: Rect | null, name: string | null) {
      if (!rect) return
      occupied.push(rect)
      if (name) modules.push({ name, rect })
    }
    for (const { line, source, target, end } of projectilePerPair(projectiles)) {
      const rect = drawProjectile(line, source, target, end, reducedMotion, pausedShot(line) ? 0 : pausedElapsed)
      recordModule(rect, line.edge.weapon)
    }

    // Render an arriving icon at its endpoint once, before releasing its lane visually.
    const drawnPerPair = new Map<string, number>()
    for (const { flight, line } of reducedMotion ? shotLines.reverse() : shotLines) {
      const source = positions.get(line.source)
      const target = positions.get(line.target)
      const count = drawnPerPair.get(flight.pair) ?? 0
      if (!source || !target || count >= 3) continue
      drawnPerPair.set(flight.pair, count + 1)
      const end = pathEnd(line, source, target)
      const arrived = t >= flight.end || reducedMotion
      const atHead = arrived ? { ...line, age: Math.min(line.age, line.travel) } : line
      const rect = drawProjectile(atHead, source, target, end, reducedMotion, 0)
      recordModule(rect, line.edge.weapon)
      if (arrived) flight.arrived = true
    }

    for (const miss of misses) drawMissMark(miss)

    for (const [node, opacity] of points) {
      const position = positions.get(node)
      if (!position) continue
      drawPoint(position, node.radius, opacity, t)
    }

    for (const [node, effects] of impacts) {
      const position = positions.get(node)
      if (!position) continue
      for (const impact of effects.values()) {
        const offset = impact.edge.kind === 'repair' && effects.has('damage') ? 16 : 0
        drawImpact(position, node.radius, impact, offset, bounds, occupied)
      }
    }

    return { related, positions, occupied, bounds, misses, modules, animating, burst: reducedMotion ? null : burst }
  }

  // Synthetic timings and amounts illustrate the same effects the replay paints.
  function paintSample(kind: ReplaySample, width: number, height: number, elapsed: number, reducedMotion: boolean) {
    under.clearRect(0, 0, width, height)
    const damage = typeof kind === 'object'
    const interactionKind = damage ? 'damage' : kind === 'point' ? 'ewar' : kind === 'kill' || kind === 'shake' ? 'damage' : kind
    const source = { x: 8, y: height / 2 }
    const target = { x: width - 26, y: height / 2 }
    const radius = 5
    if (kind === 'kill') {
      ring(under, target.x, target.y, radius, color('dead'), 2, 1)
      burst(target, radius, reducedMotion ? 210 : elapsed % 950)
      return
    }
    const quality = damage ? kind.quality : null
    const edge: ReplayEdge = {
      t: 0, from: 'char:1', to: 'char:2', kind: interactionKind, quality, weapon: null,
      repairType: null, ewar: null, sources: [], corroborated: false,
      amount: interactionKind === 'miss' ? 0 : 124, strength: 0.6,
    }
    const style = hitTracerStyle(interactionKind, quality, edge.strength)
    const shooter = { ...source, radius, color: 'var(--color-side-0)' }
    const tone = edgeColor(edge, shooter, style.sideShare)
    const age = damage ? 250 : reducedMotion ? 250 : elapsed % 1600
    if (kind === 'shake') {
      const offset = hitOffset(age, 0, impactShake(edge.strength, age - shotTravelMs, reducedMotion))
      target.x += offset.x
      target.y += offset.y
    }
    const line: Line = { edge, source: shooter, target: { ...target, radius }, age, travel: shotTravelMs, lifetime: fade, opacity: 1, style, color: tone }
    const end = pathEnd(line, source, target)
    const miss = damage ? undefined : drawLine(line, source, target, end, reducedMotion, 0)
    if (damage) strokeLine(line, source, target, 0, 1, 1, style.width)
    ring(under, source.x, source.y, radius, color('side-0'), 1.5, 1)
    ring(under, target.x, target.y, radius, color('side-1'), 1.5, 1)
    if (kind === 'point') drawPoint(target, radius, 1, reducedMotion ? 0 : elapsed)
    if (!damage && kind !== 'shake' && kind !== 'miss') drawProjectile(line, source, target, end, reducedMotion, 0, true)
    if (miss) drawMissMark(miss)
    if (kind === 'repair' || kind === 'neut') {
      const bounds = { x: 0, y: 0, width, height }
      drawImpact(target, radius, { edge: { ...edge, amount: 0 }, age: reducedMotion ? 150 : age % 700, opacity: 1, color: tone }, 0, bounds, [])
    }
  }

  refreshTokens()
  return { paint, liveEdges, refreshTokens, paintSample }
}
