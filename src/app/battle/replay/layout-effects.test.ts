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

  it('places three sides left, right, and top with larger opponents first', () => {
    const anchors = sideAnchors([7, 5, 2], 1000, 600, new Map([[7, 1], [2, 9], [5, 5]]))
    expect(anchors.get(7)?.x).toBeLessThan(500)
    expect(anchors.get(2)?.x).toBeGreaterThan(500)
    expect(anchors.get(7)?.y).toBe(anchors.get(2)?.y)
    expect(anchors.get(5)?.x).toBeCloseTo(500)
    expect(anchors.get(5)?.y).toBeLessThan(300)
  })

  it('orders four sides left and then clockwise from the right, with the unassigned row farther down', () => {
    const anchors = sideAnchors([7, 9, 5, 2], 1000, 600, new Map([[7, 1], [2, 9], [5, 5], [9, 3]]))
    expect(anchors.get(7)?.x).toBeLessThan(500)
    expect(anchors.get(2)?.x).toBeGreaterThan(500)
    expect(anchors.get(7)?.y).toBe(anchors.get(2)?.y)
    expect(anchors.get(5)?.x).toBeCloseTo(500)
    expect(anchors.get(5)?.y).toBeGreaterThan(300)
    expect(anchors.get(9)?.x).toBeCloseTo(500)
    expect(anchors.get(9)?.y).toBeLessThan(300)
    expect(anchors.get(-1)).toEqual({ x: 500, y: 540 })
    expect(anchors.get(5)!.y).toBeLessThan(anchors.get(-1)!.y)
  })

  it.each([5, 8])('keeps our side left and orders the other %i-side anchors clockwise from the right', (size) => {
    const order = [7, 9, 2, 13, 5, 3, 11, 8].slice(0, size)
    const counts = new Map([[7, 2], [2, 15], [5, 12], [9, 8], [13, 6], [11, 4], [8, 3], [3, 1]])
    const populationOrder = [2, 5, 9, 13, 11, 8, 3].filter((side) => order.includes(side))
    const anchors = sideAnchors(order, 1000, 600, counts)
    expect(anchors.get(7)).toEqual({ x: 220, y: 308 })
    const angles = populationOrder.map((side) => {
      const { x, y } = anchors.get(side)!
      return Math.atan2((y - 308) / 174, (x - 500) / 280)
    })
    const expected = size === 5 ? [36, 108, -108, -36] : [0, 45, 90, 135, -135, -90, -45]
    angles.forEach((angle, index) => expect(angle * 180 / Math.PI).toBeCloseTo(expected[index]!))
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
