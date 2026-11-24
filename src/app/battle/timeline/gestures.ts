import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { TimeRange, usePlayback, useView } from '@/app/state/view-store'
import { clamp, second, zoomDomain } from './model'

interface Drag {
  id: number
  mode: 'seek' | 'range' | 'touch'
  start: number
  startX: number
  moved: boolean
}

interface Pinch {
  distance: number
  anchor: number
  domain: TimeRange
}

const dragSlop = 4
const ordered = (a: number, b: number): TimeRange => a <= b ? [a, b] : [b, a]
const pinchGeometry = (points: Map<number, number>) => {
  const [left, right] = points.values()
  if (left === undefined || right === undefined) return null
  return { middle: (left + right) / 2, distance: Math.max(1, Math.abs(left - right)) }
}

function fractionAt(chart: SVGSVGElement, clientX: number, left: number, right: number) {
  const { left: pageX, width } = chart.getBoundingClientRect()
  return clamp((clientX - pageX - left) / Math.max(1, width - left - right), 0, 1)
}

export function useTimelineGestures(
  full: TimeRange, left: number, right: number, view: ReturnType<typeof useView> & ReturnType<typeof usePlayback>,
  onDrag: () => void,
) {
  const chart = useRef<SVGSVGElement>(null)
  const [width, setWidth] = useState(960)
  const [zoom, setZoom] = useState<TimeRange | null>(null)
  const [hover, setHover] = useState<number | null>(null)
  const [focusReadout, setFocusReadout] = useState(false)
  const [draft, setDraft] = useState<TimeRange | null>(null)
  const drag = useRef<Drag | null>(null)
  const keyboardRange = useRef<{ anchor: number; edge: number } | null>(null)
  const touches = useRef(new Map<number, number>())
  const pinch = useRef<Pinch | null>(null)
  const [fullStart, fullEnd] = full
  const domain = zoom ? zoomDomain(full, zoom, 0, 1) : full
  const [start, end] = domain

  useEffect(() => {
    const element = chart.current
    if (!element) return
    function resize() {
      const size = element!.getBoundingClientRect().width
      if (size > 0) setWidth(size)
    }
    resize()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = chart.current
    if (!element) return
    function wheel(event: WheelEvent) {
      if (event.deltaY === 0) return
      event.preventDefault()
      const bounds: TimeRange = [fullStart, fullEnd]
      const anchor = fractionAt(element!, event.clientX, left, right)
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 320 : 1
      const scale = Math.exp(clamp(event.deltaY * unit / 360, -4, 4))
      setZoom((previous) => {
        const current = previous ? zoomDomain(bounds, previous, 0, 1) : bounds
        const result = zoomDomain(bounds, current, anchor, scale)
        return result[1] - result[0] >= fullEnd - fullStart ? null : result
      })
      setHover(null)
    }
    element.addEventListener('wheel', wheel, { passive: false })
    return () => element.removeEventListener('wheel', wheel)
  }, [fullStart, fullEnd, left, right])

  function timeAt(event: PointerEvent<SVGSVGElement>) {
    return Math.round(start + (end - start) * fractionAt(event.currentTarget, event.clientX, left, right))
  }

  function onPointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return
    const isTouch = event.pointerType === 'touch'
    if (!isTouch && drag.current) return
    event.currentTarget.focus({ preventScroll: true })
    event.currentTarget.setPointerCapture?.(event.pointerId)
    keyboardRange.current = null
    setFocusReadout(false)
    setHover(null)
    if (isTouch) {
      touches.current.set(event.pointerId, event.clientX)
      if (touches.current.size > 1) {
        const geometry = pinchGeometry(touches.current)!
        if (!pinch.current) {
          pinch.current = {
            distance: geometry.distance, domain,
            anchor: fractionAt(event.currentTarget, geometry.middle, left, right),
          }
        }
        drag.current = null
        setDraft(null)
        return
      }
    }
    const time = timeAt(event)
    const mode = isTouch ? 'touch' : event.shiftKey ? 'range' : 'seek'
    drag.current = { id: event.pointerId, mode, start: time, startX: event.clientX, moved: false }
    if (mode === 'range') setDraft([time, time])
    if (mode === 'seek') {
      view.pause()
      view.seek(time)
    }
  }

  function onPointerMove(event: PointerEvent<SVGSVGElement>) {
    if (touches.current.has(event.pointerId)) touches.current.set(event.pointerId, event.clientX)
    if (pinch.current) {
      const geometry = pinchGeometry(touches.current)
      if (!geometry) return
      const { distance, anchor, domain: initial } = pinch.current
      const destination = fractionAt(event.currentTarget, geometry.middle, left, right)
      const result = zoomDomain(full, initial, anchor, distance / geometry.distance, destination)
      setZoom(result[1] - result[0] >= fullEnd - fullStart ? null : result)
      return
    }

    const active = drag.current
    const time = timeAt(event)
    if (!active) {
      if (event.pointerType !== 'touch') setHover(time)
    } else if (active.id === event.pointerId) {
      const moved = Math.abs(event.clientX - active.startX) >= dragSlop
      if (active.mode === 'range') setDraft(ordered(active.start, time))
      else {
        if (!active.moved && active.mode === 'touch') {
          // Ignore the first finger's small movements while a pinch starts.
          if (!moved) return
          view.pause()
        }
        view.seek(time)
      }
      active.moved ||= moved
    }
  }

  function endPointer(event: PointerEvent<SVGSVGElement>) {
    touches.current.delete(event.pointerId)
    if (touches.current.size === 0) pinch.current = null
    const active = drag.current
    if (active?.id !== event.pointerId) return
    drag.current = null
    if (event.type === 'pointerup') {
      const time = timeAt(event)
      const selectedRange = active.mode === 'range' && time !== active.start
      if (active.mode === 'range') {
        if (selectedRange) view.setRange(ordered(active.start, time))
      } else {
        view.pause()
        view.seek(time)
      }
      if (selectedRange || active.moved || Math.abs(event.clientX - active.startX) >= dragSlop) onDrag()
    }
    setDraft(null)
  }

  function onKeyDown(event: KeyboardEvent<SVGSVGElement>) {
    if (event.defaultPrevented) return
    if (event.key === 'Escape' && (view.range || drag.current?.mode === 'range')) {
      event.preventDefault()
      drag.current = null
      keyboardRange.current = null
      setDraft(null)
      view.setRange(null)
      return
    }
    const direction = { ArrowLeft: -1, ArrowDown: -1, ArrowRight: 1, ArrowUp: 1 }[event.key]
    if (event.shiftKey && direction !== undefined) {
      event.preventDefault()
      view.pause()
      setFocusReadout(true)
      setHover(null)
      const previous = view.range ? keyboardRange.current : null
      const anchor = previous?.anchor ?? clamp(view.t, start, end)
      const edge = clamp((previous?.edge ?? anchor) + direction * 10 * second, start, end)
      keyboardRange.current = { anchor, edge }
      view.setRange(edge === anchor ? null : ordered(anchor, edge))
      return
    }
    const time = {
      Home: start, End: end,
    }[event.key] ?? (direction === undefined ? undefined : view.t + direction * second)
    if (typeof time !== 'number') return
    event.preventDefault()
    keyboardRange.current = null
    setFocusReadout(true)
    setHover(null)
    view.pause()
    view.seek(clamp(time, start, end))
  }

  const events = {
    onPointerDown, onPointerMove, onPointerUp: endPointer, onPointerCancel: endPointer,
    onLostPointerCapture: endPointer, onPointerLeave: () => setHover(null), onKeyDown,
    onFocus: () => { setFocusReadout(true); setHover(null) },
    onBlur: () => { setFocusReadout(false); keyboardRange.current = null },
  }
  const readout = hover ?? (focusReadout ? clamp(view.t, start, end) : null)
  return { chart, width, start, end, readout, focusReadout, range: draft ?? view.range, events }
}
