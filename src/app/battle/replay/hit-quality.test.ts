// @vitest-environment jsdom
import { expect, it } from 'vitest'
import { hitTracerStyle } from './hit-quality'
import { makePainter } from './paint'
import { makeLayout, type ReplayEdge, type ReplayPilot } from './scene'

it('maps hits to five ordered shades and widths of the source side color', () => {
  const qualities = ['Grazes', 'Glances Off', 'Hits', 'Penetrates', 'Smashes', 'Wrecks'] as const
  const style = qualities.map((quality) => hitTracerStyle('damage', quality, 0.5))
  expect(style.map(({ sideShare }) => sideShare)).toEqual([30, 30, 45, 62, 80, 100])
  expect(style.slice(1).every(({ width }, index) => index === 0 || width > style[index]!.width)).toBe(true)
  expect(style.every(({ end, dash }) => end === 1 && dash.length === 0)).toBe(true)
})

it('represents a miss with a short dashed line that never hits or shakes the target', () => {
  const miss = hitTracerStyle('miss', null, 1)
  expect(miss.end).toBeLessThan(1)
  expect(miss.dash.length).toBeGreaterThan(0)
  expect(miss.shakesTarget).toBe(false)
  expect(hitTracerStyle('damage', 'Hits', 1).shakesTarget).toBe(true)
})

it('paints a short miss trace with dashes while leaving the target still', () => {
  const strokeDashes: number[][] = []
  const ends: { x: number; y: number }[] = []
  let dash: number[] = []
  const noOp = () => {}
  const context = {
    clearRect: noOp, beginPath: noOp, moveTo: noOp, arc: noOp, fill: noOp,
    lineTo: (x: number, y: number) => ends.push({ x, y }),
    setLineDash: (value: number[]) => { dash = value },
    stroke: () => strokeDashes.push(dash),
  } as unknown as CanvasRenderingContext2D
  const makePilot = (id: number, side: number): ReplayPilot => ({
    entity: { key: `char:${id}`, name: String(id), charId: id, side, sideSource: 'br', hasLog: true, shipTypes: [] },
    color: 'var(--color-side-0)', ship: null, shipId: null, primaryEnemy: false, letter: null, deaths: [],
  })
  const painter = makePainter(context, context, document.body, noOp)
  const layout = makeLayout([makePilot(1, 0), makePilot(2, 1)], [0, 1], 660, 560)
  const [source, target] = layout.nodes
  const present = new Set([source!.entity.key, target!.entity.key])
  const miss: ReplayEdge = {
    t: 500, from: source!.entity.key, to: target!.entity.key, kind: 'miss',
    amount: 0, weapon: null, quality: null, repairType: null, ewar: null, sources: [], corroborated: false, strength: 0,
  }
  layout.placeVisible(present, [miss])
  for (const t of [500, 875, 1025]) {
    const { positions } = painter.paint(layout, [miss], [], present,
      { t, selected: null, focusOnly: false, reducedMotion: false, playing: true }, 660, 560)
    expect(positions.get(target!)).toEqual({ x: target!.x, y: target!.y })
  }
  expect(strokeDashes).toEqual([[2, 4], [2, 4], [2, 4]])
  expect(ends.every(({ x }) => x > source!.x && x < target!.x - target!.radius)).toBe(true)
})
