import type { Interaction } from '@/core/contract'
import { describe, expect, it } from 'vitest'
import { interactionScales, interactionWindow, impactShake, sideAnchors, tracerWidth } from './layout-effects'

function interaction(t: number, kind: Interaction['kind'], amount: number): Interaction {
  return {
    t, kind, amount, from: 'char:1', to: 'char:2', weapon: null, quality: null,
    repairType: null, ewar: null, sources: [], corroborated: false,
  }
}

describe('replay layout and effects', () => {
  it('anchors two sides left and right using the supplied side order', () => {
    const anchors = sideAnchors([7, 2], 1000, 600)
    expect(anchors.get(7)?.x).toBeLessThan(500)
    expect(anchors.get(2)?.x).toBeGreaterThan(500)
    expect(anchors.get(7)?.y).toBe(anchors.get(2)?.y)
    expect(anchors.get(-1)).toEqual({ x: 500, y: 540 })
  })

  it('reserves the top for the third side and anchors four sides in distinct sectors', () => {
    const three = sideAnchors([7, 2, 5], 1000, 600)
    expect(three.get(5)?.x).toBeCloseTo(500)
    expect(three.get(5)?.y).toBeLessThan(300)

    const four = sideAnchors([7, 2, 5, 9], 1000, 600)
    expect(four.get(7)?.x).toBeLessThan(500)
    expect(four.get(2)?.x).toBeGreaterThan(500)
    expect(four.get(5)?.y).toBeGreaterThan(four.get(2)?.y ?? Infinity)
    expect(four.get(9)?.y).toBeLessThan(four.get(2)?.y ?? -Infinity)
    expect(four.get(-1)?.y).toBeGreaterThan(four.get(5)?.y ?? Infinity)
  })

  it('scales quantities logarithmically and independently by kind', () => {
    const damage = [1, 10, 100].map((amount) => interaction(0, 'damage', amount))
    const repair = [100, 1000, 10000].map((amount) => interaction(0, 'repair', amount))
    const neut = [10, 20, 40].map((amount) => interaction(0, 'neut', amount))
    const scales = interactionScales([...damage, ...repair, ...neut])
    expect(scales.damage(10)).toBeCloseTo(0.5)
    expect(scales.repair(10)).toBe(0)
    expect(scales.repair(1000)).toBeCloseTo(0.5)
    expect(scales.neut(20)).toBeCloseTo(0.5)
    expect(tracerWidth(scales.damage(1))).toBeLessThan(tracerWidth(scales.damage(100)))
    expect(impactShake(scales.damage(1), 80, false)).toBeLessThan(impactShake(scales.damage(100), 80, false))
    expect(impactShake(1, 80, true)).toBe(0)
    expect(impactShake(1, 320, false)).toBe(0)
  })

  it('includes all same-time events, skips the future, and expires at three seconds', () => {
    const events = [0, 1, 1000, 3000, 3000, 3001].map((t) => interaction(t, 'damage', 1))
    const [start, end] = interactionWindow(events, 3000, 3000)
    expect(events.slice(start, end).map(({ t }) => t)).toEqual([1, 1000, 3000, 3000])
    expect(interactionWindow(events, -1, 3000)).toEqual([0, 0])
    expect(interactionWindow(events, 6001, 3000)).toEqual([events.length, events.length])
  })
})
