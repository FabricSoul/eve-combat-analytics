import type { EntityKey, EwarSpan } from '@/core/contract'
import { fmtNum } from '@/app/lib/format'
import { typeIconUrl } from '@/app/lib/images'
import { impactShake, interactionWindow, tracerWidth } from './layout-effects'
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

  function strokeLine(line: Line, from: number, to: number, opacity: number, width: number) {
    const { kind, strength } = line.edge
    const { x, y } = line.source
    const dx = line.target.x - x
    const dy = line.target.y - y
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

  function drawLine(line: Line, frame: ReplayFrame) {
    const { edge, source, target, opacity, age } = line
    if (source === target) return
    const width = edge.amount > 0 ? tracerWidth(edge.strength) : 1.25
    const entrance = frame.reducedMotion ? 1 : Math.min(1, 0.18 + age / appear)
    const trailAlpha = frame.reducedMotion ? 0.42 : (1 - age / fade) * entrance * 0.24
    strokeLine(line, 0, 1, opacity * trailAlpha, 0.6 + width * 0.35)

    const travel = age / 650
    if (!frame.reducedMotion && travel < 1 && opacity > 0.2) {
      const from = Math.max(0, travel - 0.35)
      const capDrain = edge.kind === 'neut' || edge.kind === 'nos'
      strokeLine(line, capDrain ? 1 - travel : from, capDrain ? 1 - from : travel, opacity * entrance, width)
      const head = capDrain ? 1 - travel : travel
      under.beginPath()
      under.arc(source.x + (target.x - source.x) * head, source.y + (target.y - source.y) * head, 2.5, 0, tau)
      under.fillStyle = line.color
      under.fill()
    }
  }

  function drawModule(line: Line, count: number, reducedMotion: boolean) {
    const { source, target, age, edge, opacity } = line
    if (!edge.weapon || source === target || opacity < 0.25 || age > (reducedMotion ? fade : 1350)) return
    const x = (source.x + target.x) / 2
    const y = (source.y + target.y) / 2 - 10 - 13 * count
    const icon = moduleIcon(edge.weapon)
    if (icon === undefined) return
    under.globalAlpha = opacity * (reducedMotion ? 1 : Math.min(1, (1350 - age) / 420))
    if (icon) {
      under.drawImage(icon, x - 9, y - 9, 18, 18)
    } else {
      const clipped = edge.weapon.length > 27 ? edge.weapon.slice(0, 26) + '…' : edge.weapon
      under.font = `11px ${font}`
      under.textAlign = 'center'
      under.lineWidth = 3
      under.strokeStyle = color('bg')
      under.fillStyle = color('text-2')
      under.strokeText(clipped, x, y)
      under.fillText(clipped, x, y)
    }
  }

  function drawImpact(node: ReplayNode, impact: Impact, numberOffset: number) {
    const { edge, age, opacity, color: tone } = impact
    const { strength, amount, kind } = edge
    const { x, y, radius } = node
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
    over.globalAlpha = opacity * (1 - textProgress)
    over.font = `500 ${11 + 6 * strength}px ${mono}`
    over.textAlign = 'right'
    over.strokeStyle = color('bg')
    over.fillStyle = color('text')
    over.lineWidth = 3
    const value = `${kind === 'repair' ? '+' : '−'}${fmtNum(Math.round(amount))}`
    const textWidth = over.measureText(value).width
    const labelX = Math.min(hostWidth - 3, x + radius + 4 + textWidth)
    const labelY = y - radius - numberOffset - 17 * textProgress
    over.strokeText(value, labelX, labelY)
    over.fillText(value, labelX, labelY)
  }

  function burst(node: ReplayNode, age: number) {
    for (let index = 0; index < 3; index++) {
      const progress = (age - index * 110) / 700
      if (progress < 0 || progress >= 1) continue
      const growth = 1 - (1 - progress) ** 3
      ring(over, node.x, node.y, node.radius + (26 + index * 10) * growth,
        color(index === 1 ? 'accent-line' : 'text'), 3 - index * 0.75, 1 - progress)
    }
  }

  let hostWidth = 0

  function paint(
    layout: ReplayLayout, edges: readonly ReplayEdge[], pointSpans: readonly EwarSpan[],
    frame: ReplayFrame, width: number, height: number,
  ) {
    hostWidth = width
    under.clearRect(0, 0, width, height)
    over.clearRect(0, 0, width, height)
    const { t, selected, focusOnly, reducedMotion } = frame
    const related = new Set<EntityKey>()
    const lines = new Map<string, Line>()
    const impacts = new Map<ReplayNode, Map<ReplayEdge['kind'], Impact>>()
    const shakes = new Map<ReplayNode, number>()
    const points = new Map<ReplayNode, number>()
    const [start, end] = interactionWindow(edges, t, fade)

    for (let index = start; index < end; index++) {
      const edge = edges[index]!
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
      const key = `${source.index}:${target.index}:${edge.kind}`
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

    for (const line of lines.values()) drawLine(line, frame)
    // Keep crossings readable by showing a label for each recent directed pair and kind.
    const moduleRows = new Map<string, number>()
    for (const line of [...lines.values()].sort((a, b) => drawRank[a.edge.kind] - drawRank[b.edge.kind])) {
      if (!line.edge.weapon || line.source === line.target || line.age > (reducedMotion ? fade : 1350) || line.opacity < 0.25) continue
      const key = `${line.source.index}:${line.target.index}`
      const row = moduleRows.get(key) ?? 0
      drawModule(line, row, reducedMotion)
      moduleRows.set(key, row + 1)
    }

    for (const [node, opacity] of points) {
      const angle = (t % 2400) / 2400 * tau
      under.setLineDash([3, 4])
      ring(under, node.x, node.y, node.radius + 7, color('text'), 1.5, opacity, [angle, angle + tau])
      under.setLineDash([])
    }

    for (const [node, effects] of impacts) {
      for (const impact of effects.values()) {
        const offset = impact.edge.kind === 'repair' && effects.has('damage') ? 16 : 0
        drawImpact(node, impact, offset)
      }
    }

    return { related, shakes, burst: reducedMotion ? null : burst }
  }

  refreshTokens()
  return { paint, refreshTokens }
}
