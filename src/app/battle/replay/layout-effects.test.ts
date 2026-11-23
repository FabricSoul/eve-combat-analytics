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

  it('places three sides left, right, and top in the supplied order', () => {
    const anchors = sideAnchors([7, 2, 5], 1000, 600)
    expect(anchors.get(7)?.x).toBeLessThan(500)
    expect(anchors.get(2)?.x).toBeGreaterThan(500)
    expect(anchors.get(7)?.y).toBe(anchors.get(2)?.y)
    expect(anchors.get(5)?.x).toBeCloseTo(500)
    expect(anchors.get(5)?.y).toBeLessThan(300)
  })

  it('adds the fourth side below center with the unassigned row farther down', () => {
    const anchors = sideAnchors([7, 2, 5, 9], 1000, 600)
    expect(anchors.get(7)?.x).toBeLessThan(500)
    expect(anchors.get(2)?.x).toBeGreaterThan(500)
    expect(anchors.get(7)?.y).toBe(anchors.get(2)?.y)
    expect(anchors.get(5)?.x).toBeCloseTo(500)
    expect(anchors.get(5)?.y).toBeLessThan(300)
    expect(anchors.get(9)?.x).toBeCloseTo(500)
    expect(anchors.get(9)?.y).toBeGreaterThan(300)
    expect(anchors.get(-1)).toEqual({ x: 500, y: 540 })
    expect(anchors.get(9)!.y).toBeLessThan(anchors.get(-1)!.y)
  })

  it('fills upper-right and lower-right gaps before the left side', () => {
    const anchors = sideAnchors([7, 2, 5, 9, 13, 11, 8, 3], 1000, 600)
    expect(anchors.get(13)!.x).toBeGreaterThan(500)
    expect(anchors.get(13)!.y).toBeLessThan(308)
    expect(anchors.get(11)!.x).toBeGreaterThan(500)
    expect(anchors.get(11)!.y).toBeGreaterThan(308)
    expect(anchors.get(8)!.x).toBeLessThan(500)
    expect(anchors.get(8)!.y).toBeLessThan(308)
    expect(anchors.get(3)!.x).toBeLessThan(500)
    expect(anchors.get(3)!.y).toBeGreaterThan(308)
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
