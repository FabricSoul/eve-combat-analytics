import type { Point } from './layout-effects'

export interface ReplayCamera extends Point {
  scale: number
}

export const initialCamera: ReplayCamera = { x: 0, y: 0, scale: 1 }
export const zoomStep = 1.25
export const minZoom = 0.5
export const maxZoom = 6

export function projectPoint(camera: ReplayCamera, point: Point): Point {
  return { x: point.x * camera.scale + camera.x, y: point.y * camera.scale + camera.y }
}

export function panCamera(camera: ReplayCamera, delta: Point): ReplayCamera {
  return { ...camera, x: camera.x + delta.x, y: camera.y + delta.y }
}

export function zoomCamera(camera: ReplayCamera, anchor: Point, factor: number): ReplayCamera {
  const scale = Math.max(minZoom, Math.min(maxZoom, camera.scale * factor))
  if (scale === camera.scale) return camera
  const relative = scale / camera.scale
  return {
    scale,
    x: anchor.x - (anchor.x - camera.x) * relative,
    y: anchor.y - (anchor.y - camera.y) * relative,
  }
}

export function shouldStartDrag(delta: Point) {
  return Math.hypot(delta.x, delta.y) >= 5
}
