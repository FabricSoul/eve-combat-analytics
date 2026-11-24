import { describe, expect, it } from 'vitest'
import { makeLayout, type ReplayPilot } from './scene'

// Design rule (布局): node radius r15 with log / r13 main enemy / r9 others; one size smaller when the canvas is shorter than 420.
function pilot(id: number, side: number, hasLog: boolean, primaryEnemy = false): ReplayPilot {
  return {
    entity: { key: `char:${id}`, side, name: String(id), charId: id, hasLog, sideSource: 'br', shipTypes: [] },
    ship: null, shipId: null, primaryEnemy, color: 'var(--color-side-0)', letter: null, deaths: [],
  }
}
const pilots = [pilot(1, 0, true), pilot(2, 1, false, true), pilot(3, 1, false)]
const radii = (height: number) => Object.fromEntries(makeLayout(pilots, [0, 1], 900, height).nodes.map((n) => [n.entity.key, n.radius]))

describe('replay canvas size step', () => {
  it('uses the full node sizes on a canvas 420 px or taller', () => {
    expect(radii(420)).toEqual({ 'char:1': 15, 'char:2': 13, 'char:3': 9 })
  })
  it('drops one size step below 420 px', () => {
    expect(radii(419)).toEqual({ 'char:1': 12, 'char:2': 11, 'char:3': 8 })
  })
})
