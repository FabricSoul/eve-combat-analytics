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
const radii = (height: number, width: number) =>
  Object.fromEntries(makeLayout(pilots, [0, 1], width, height, 62).nodes.map((node) => [node.entity.key, node.radius]))

describe.each([882, 390])('replay canvas size step at %i px wide', (width) => {
  it('uses the full node sizes on a canvas 420 px or taller', () => {
    expect(radii(420, width)).toEqual({ 'char:1': 15, 'char:2': 13, 'char:3': 9 })
  })
  it.each([419, 183, 79])('uses one smaller size tier at %i px', (height) => {
    expect(radii(height, width)).toEqual({ 'char:1': 12, 'char:2': 11, 'char:3': 8 })
  })
})
