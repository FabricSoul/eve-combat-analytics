import { expect, it } from 'vitest'
import { initialCamera, panCamera, projectPoint, shouldStartDrag, zoomCamera } from './camera'

it('keeps the pointer anchored when zooming and clamps to 0.5–6×', () => {
  const pointer = { x: 134, y: 210 }
  const first = zoomCamera(initialCamera, pointer, 3)
  expect(projectPoint(first, pointer)).toEqual(pointer)
  const close = zoomCamera(first, pointer, 100)
  expect(close.scale).toBe(6)
  expect(projectPoint(close, pointer)).toEqual(pointer)
  const far = zoomCamera(close, pointer, 0.001)
  expect(far.scale).toBe(0.5)
  expect(projectPoint(far, pointer)).toEqual(pointer)
})

it('projects the hit target by the zoom and drag delta, with a fixed screen radius', () => {
  const center = { x: 35, y: 30 }
  const camera = panCamera(zoomCamera(initialCamera, { x: 5, y: 10 }, 2), { x: 20, y: -6 })
  const target = projectPoint(camera, center)
  expect(target).toEqual({ x: 85, y: 44 })
  const hit = (x: number, y: number) => Math.hypot(x - target.x, y - target.y) <= 15
  expect(hit(95, 44)).toBe(true)
  expect(hit(105, 44)).toBe(false)
  expect(hit(center.x, center.y)).toBe(false)
})

it('resolves pointer jitter as a click and starts panning at five pixels', () => {
  expect(shouldStartDrag({ x: 3, y: 3 })).toBe(false)
  expect(shouldStartDrag({ x: -3, y: -4 })).toBe(true)
})
