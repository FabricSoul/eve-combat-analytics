import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, MouseEvent, PointerEvent, RefObject } from 'react'
import { initialCamera, panCamera, shouldStartDrag, zoomCamera, zoomStep } from './camera'
import type { Point } from './layout-effects'

interface Gesture {
  pointers: Map<number, Point>
  origin: Point
  canPan: boolean
  moved: boolean
}

const difference = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y })
const midpoint = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 })
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y)
const onControl = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('.replay-header'))

function localPoint(element: HTMLElement, event: { clientX: number; clientY: number }): Point {
  const rect = element.getBoundingClientRect()
  return { x: event.clientX - rect.left, y: event.clientY - rect.top }
}

export function useReplayCamera(host: RefObject<HTMLDivElement | null>) {
  const [camera, setCamera] = useState(initialCamera)
  const gesture = useRef<Gesture | null>(null)
  const ignoreClick = useRef(false)

  useEffect(() => {
    const element = host.current
    if (!element) return
    function onWheel(event: WheelEvent) {
      if (onControl(event.target) || !event.deltaY) return
      event.preventDefault()
      const anchor = localPoint(element!, event)
      const pixels = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element!.clientHeight : 1)
      setCamera((current) => zoomCamera(current, anchor, Math.exp(-pixels * (event.ctrlKey ? 0.01 : 0.002))))
    }
    element.addEventListener('wheel', onWheel, { passive: false })
    return () => element.removeEventListener('wheel', onWheel)
  }, [host])

  function reset() {
    setCamera(initialCamera)
  }

  function zoom(factor: number) {
    const element = host.current
    if (!element) return
    const center = { x: element.clientWidth / 2, y: element.clientHeight / 2 }
    setCamera((current) => zoomCamera(current, center, factor))
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.defaultPrevented || onControl(event.target) || event.altKey || event.metaKey || event.ctrlKey) return
    switch (event.key) {
      case '+':
      case '=':
        zoom(zoomStep)
        break
      case '-':
      case '−':
        zoom(1 / zoomStep)
        break
      case '0':
        reset()
        break
      default:
        return
    }
    event.preventDefault()
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || onControl(event.target)) return
    const element = event.currentTarget
    const onPilot = event.target instanceof Element && Boolean(event.target.closest('.replay-pilot'))
    if (!gesture.current) ignoreClick.current = false
    if (onPilot && event.pointerType !== 'touch') return
    const point = localPoint(element, event)
    if (!gesture.current) {
      gesture.current = {
        pointers: new Map(), origin: point,
        canPan: !onPilot && (event.pointerType !== 'touch' || camera.scale > 1),
        moved: false,
      }
    }
    const { pointers } = gesture.current
    if (pointers.size && event.pointerType !== 'touch') return
    if (pointers.size >= 2) return
    pointers.set(event.pointerId, point)
    if (event.pointerType !== 'touch') element.setPointerCapture(event.pointerId)
    if (pointers.size === 2) {
      for (const id of pointers.keys()) element.setPointerCapture(id)
    }
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current
    const element = event.currentTarget
    const previous = active?.pointers.get(event.pointerId)
    if (!active || !previous) return
    const next = localPoint(element, event)
    active.pointers.set(event.pointerId, next)
    if (active.pointers.size === 2) {
      const other = [...active.pointers].find(([id]) => id !== event.pointerId)![1]
      const before = midpoint(previous, other)
      const delta = difference(midpoint(next, other), before)
      const factor = distance(next, other) / Math.max(1, distance(previous, other))
      active.moved = true
      active.canPan = true
      setCamera((current) => panCamera(zoomCamera(current, before, factor), delta))
    } else if (active.canPan) {
      if (!active.moved && !shouldStartDrag(difference(next, active.origin))) return
      const delta = difference(next, active.moved ? previous : active.origin)
      active.moved = true
      if (!element.hasPointerCapture(event.pointerId)) element.setPointerCapture(event.pointerId)
      setCamera((current) => panCamera(current, delta))
    }
  }

  function onPointerEnd(event: PointerEvent<HTMLDivElement>) {
    const active = gesture.current
    if (!active?.pointers.delete(event.pointerId)) return
    if (active.pointers.size === 0) {
      ignoreClick.current = active.moved
      gesture.current = null
    } else {
      active.origin = active.pointers.values().next().value!
    }
  }

  function onClickCapture(event: MouseEvent<HTMLDivElement>) {
    if (!ignoreClick.current || event.detail === 0) return
    ignoreClick.current = false
    event.preventDefault()
    event.stopPropagation()
  }

  function onDoubleClick(event: MouseEvent<HTMLDivElement>) {
    if (!onControl(event.target)) reset()
  }

  return {
    camera, zoom, reset,
    handlers: {
      onKeyDown, onPointerDown, onPointerMove, onPointerUp: onPointerEnd, onPointerCancel: onPointerEnd,
      onLostPointerCapture: (event: PointerEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) onPointerEnd(event)
      },
      onClickCapture, onDoubleClick,
    },
  }
}
