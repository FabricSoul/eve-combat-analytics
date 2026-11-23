import type { EntityKey, EwarSpan } from '@/core/contract'
import { fmtNum } from '@/app/lib/format'
import { typeIconUrl } from '@/app/lib/images'
import { impactShake, interactionWindow, tracerWidth } from './layout-effects'
import type { Point } from './layout-effects'
import { placeAnnotation } from './placement'
import type { Rect } from './placement'
import type { ReplayEdge, ReplayLayout, ReplayNode } from './scene'

export interface ReplayFrame {
  t: number
  selected: EntityKey | null
  focusOnly: boolean
  reducedMotion: boolean
  playing: boolean
}

interface Line {
  edge: ReplayEdge
  source: ReplayNode
  target: ReplayNode
  age: number
  opacity: number
  color: string
}

interface Impact {
  edge: ReplayEdge
  age: number
  opacity: number
  color: string
}

const drawRank = { damage: 0, repair: 1, neut: 2, nos: 2, ewar: 3, miss: 4 }
const tau = 2 * Math.PI
const impactDelay = 350

export function makePainter(
  under: CanvasRenderingContext2D, over: CanvasRenderingContext2D, host: HTMLElement, invalidate: () => void,
) {
  const colors = new Map<string, string>()
  const icons = new Map<string, HTMLImageElement | null | undefined>()
  let font = ''
  let mono = ''
  let fade = 3000
  let appear = 200

  function refreshTokens() {
    const style = getComputedStyle(host)
    for (const name of ['side-0', 'side-1', 'side-2', 'side-n', 'repair', 'text', 'text-2', 'text-3', 'accent-line', 'bg', 'raised']) {
      colors.set(`var(--color-${name})`, style.getPropertyValue(`--color-${name}`).trim())
    }
    font = style.getPropertyValue('--font-ui').trim()
    mono = style.getPropertyValue('--font-mono').trim()
    const milliseconds = (name: string, fallback: number) => {
      const css = style.getPropertyValue(name).trim()
      const value = parseFloat(css)
      return value > 0 ? value * (css.endsWith('ms') ? 1 : 1000) : fallback
    }
    fade = milliseconds('--dur-edge-fade', 3000)
    appear = milliseconds('--dur-edge-in', 200)
  }

  const color = (name: string) => colors.get(`var(--color-${name})`) ?? ''
  const edgeColor = (edge: ReplayEdge, source: ReplayNode) => {
    if (edge.kind === 'damage') return colors.get(source.color) ?? color('side-n')
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
    under.setLineDash(kind === 'repair' ? [5, 3] : kind === 'ewar' || kind === 'miss' ? [2, 4] : [])
    under.lineWidth = width
    under.lineCap = 'round'
    under.strokeStyle = line.color
    under.globalAlpha = opacity
    under.stroke()
    under.setLineDash([])
  }

  function drawLine(line: Line, source: Point, target: Point, reducedMotion: boolean) {
    const { edge, opacity, age } = line
    const width = edge.amount > 0 ? tracerWidth(edge.strength) : 1.25
    const entrance = reducedMotion ? 1 : Math.min(1, 0.18 + age / appear)
    const trailAlpha = reducedMotion ? 0.42 : (1 - age / fade) * entrance * 0.24
    strokeLine(line, source, target, 0, 1, opacity * trailAlpha, 0.6 + width * 0.35)

    const travel = age / 650
    if (!reducedMotion && travel < 1 && opacity > 0.2) {
      const from = Math.max(0, travel - 0.35)
      const capDrain = edge.kind === 'neut' || edge.kind === 'nos'
      strokeLine(line, source, target, capDrain ? 1 - travel : from, capDrain ? 1 - from : travel, opacity * entrance, width)
      const head = capDrain ? 1 - travel : travel
      under.beginPath()
      under.arc(source.x + (target.x - source.x) * head, source.y + (target.y - source.y) * head, 2.5, 0, tau)
      under.fillStyle = line.color
      under.fill()
    }
  }

  function drawModule(line: Line, source: Point, target: Point, count: number, reducedMotion: boolean): Rect | null {
    const { age, edge, opacity } = line
    if (!edge.weapon) return null
    const x = (source.x + target.x) / 2
    const y = (source.y + target.y) / 2 - 10 - 13 * count
    const icon = moduleIcon(edge.weapon)
    if (icon === undefined) return null
    under.globalAlpha = opacity * (reducedMotion ? 1 : Math.min(1, (1350 - age) / 420))
    if (icon) {
      under.drawImage(icon, x - 9, y - 9, 18, 18)
      return { x: x - 9, y: y - 9, width: 18, height: 18 }
    }
    const clipped = edge.weapon.length > 27 ? edge.weapon.slice(0, 26) + '…' : edge.weapon
    under.font = `11px ${font}`
    under.textAlign = 'center'
    under.lineWidth = 3
    under.strokeStyle = color('bg')
    under.fillStyle = color('text-2')
    under.strokeText(clipped, x, y)
    under.fillText(clipped, x, y)
    const width = under.measureText(clipped).width + 3
    return { x: x - width / 2, y: y - 12, width, height: 15 }
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

  function burst({ x, y }: Point, radius: number, age: number) {
    for (let index = 0; index < 3; index++) {
      const progress = (age - index * 110) / 700
      if (progress < 0 || progress >= 1) continue
      const growth = 1 - (1 - progress) ** 3
      ring(over, x, y, radius + (26 + index * 10) * growth,
        color(index === 1 ? 'accent-line' : 'text'), 3 - index * 0.75, 1 - progress)
    }
  }

  function liveEdges(edges: readonly ReplayEdge[], t: number) {
    const [start, end] = interactionWindow(edges, t, fade)
    return edges.slice(start, end)
  }

  function paint(
    layout: ReplayLayout, live: readonly ReplayEdge[], pointSpans: readonly EwarSpan[],
    shownUnassigned: ReadonlySet<ReplayNode>, frame: ReplayFrame, width: number, height: number,
  ) {
    under.clearRect(0, 0, width, height)
    over.clearRect(0, 0, width, height)
    const { t, selected, focusOnly, reducedMotion } = frame
    const related = new Set<EntityKey>()
    const lines = new Map<string, Line>()
    const impacts = new Map<ReplayNode, Map<ReplayEdge['kind'], Impact>>()
    const shakes = new Map<ReplayNode, number>()
    const points = new Map<ReplayNode, number>()
    for (const edge of live) {
      const source = layout.byKey.get(edge.from)
      const target = layout.byKey.get(edge.to)
      if (!source || !target) continue
      const highlighted = selected === edge.from || selected === edge.to
      if (focusOnly && !highlighted) continue
      if (highlighted) {
        related.add(edge.from)
        related.add(edge.to)
      }
      const age = t - edge.t
      const opacity = selected === null || highlighted ? 1 : 0.15
      const tone = edgeColor(edge, source)
      const line = { edge, source, target, age, opacity, color: tone }
      const key = `${source.ordinal}:${target.ordinal}:${edge.kind}`
      const previous = lines.get(key)
      // Coincident paths share a tracer so the same pixels don't stack to full opacity.
      if (!previous || previous.age !== age || previous.edge.strength < edge.strength) lines.set(key, line)
      if (edge.kind === 'damage') {
        const shake = impactShake(edge.strength, age - impactDelay, reducedMotion) * opacity
        if (shake > (shakes.get(target) ?? 0)) shakes.set(target, shake)
      }
      if (!reducedMotion && edge.kind === 'ewar' && (edge.ewar === 'warp_scramble' || edge.ewar === 'warp_disrupt')) {
        points.set(target, Math.max(points.get(target) ?? 0, opacity))
      }
      const impactAge = age - impactDelay
      if (!reducedMotion && edge.amount > 0 && impactAge >= 0 && impactAge <= 1200) {
        const effects = impacts.get(target) ?? new Map<ReplayEdge['kind'], Impact>()
        const previousImpact = effects.get(edge.kind)
        if (!previousImpact || previousImpact.opacity <= opacity) {
          effects.set(edge.kind, { edge, age: impactAge, opacity, color: tone })
        }
        impacts.set(target, effects)
      }
    }

    for (const span of pointSpans) {
      if (span.start > t || span.end < t) continue
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
      const { key, side } = node.entity
      if (side === -1 && !shownUnassigned.has(node)) continue
      if (focusOnly && selected !== key && !related.has(key)) continue
      const shake = shakes.get(node) ?? 0
      const phase = (t % 1000) * 0.24 + node.ordinal
      const x = node.x + Math.sin(phase) * shake
      const y = node.y + Math.cos(phase * 1.3) * shake
      positions.set(node, { x, y })
      const inset = node.radius + 2
      occupied.push({ x: x - inset, y: y - inset, width: inset * 2 + (node.letter ? 7 : 0), height: inset * 2 })
    }

    const moduleRows = new Map<string, number>()
    for (const line of lines.values()) {
      if (line.source === line.target) continue
      const source = positions.get(line.source)
      const target = positions.get(line.target)
      if (!source || !target) continue
      drawLine(line, source, target, reducedMotion)
    }
    // Paint module icons after the tracers so crossing lines do not cover them.
    for (const line of [...lines.values()].sort((a, b) => drawRank[a.edge.kind] - drawRank[b.edge.kind])) {
      if (!line.edge.weapon || line.source === line.target || line.age > (reducedMotion ? fade : 1350) || line.opacity < 0.25) continue
      const source = positions.get(line.source)
      const target = positions.get(line.target)
      if (!source || !target) continue
      const key = `${line.source.ordinal}:${line.target.ordinal}`
      const row = moduleRows.get(key) ?? 0
      const rect = drawModule(line, source, target, row, reducedMotion)
      if (rect) occupied.push(rect)
      moduleRows.set(key, row + 1)
    }

    for (const [node, opacity] of points) {
      const position = positions.get(node)
      if (!position) continue
      const angle = (t % 2400) / 2400 * tau
      under.setLineDash([3, 4])
      ring(under, position.x, position.y, node.radius + 7, color('text'), 1.5, opacity, [angle, angle + tau])
      under.setLineDash([])
    }

    for (const [node, effects] of impacts) {
      const position = positions.get(node)
      if (!position) continue
      for (const impact of effects.values()) {
        const offset = impact.edge.kind === 'repair' && effects.has('damage') ? 16 : 0
        drawImpact(position, node.radius, impact, offset, bounds, occupied)
      }
    }

    return { related, positions, occupied, bounds, burst: reducedMotion ? null : burst }
  }

  refreshTokens()
  return { paint, liveEdges, refreshTokens }
}
