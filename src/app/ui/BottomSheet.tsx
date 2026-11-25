import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Tabs, type TabOption } from './Tabs'

const heights = ['收起', '半屏', '全屏'] as const
const peek = 0
const half = 1
const full = 2
type SheetHeight = typeof peek | typeof half | typeof full
const storageKey = 'eve-combat-analytics:phone-sheet-height'
const minimumMapHeight = 160

function storedHeight(): SheetHeight | null {
  try {
    const value = localStorage.getItem(storageKey)
    if (value === '0') return peek
    if (value === '1') return half
    if (value === '2') return full
  } catch {
    // Keep the automatic default when storage is unavailable.
  }
  return null
}

interface BottomSheetProps<T extends string> {
  tabs: readonly TabOption<T>[]
  value: T
  onChange(value: T): void
  children: ReactNode
}

export function BottomSheet<T extends string>({ tabs, value, onChange, children }: BottomSheetProps<T>) {
  const id = useId()
  const [chosenHeight, setChosenHeight] = useState(storedHeight)
  const [halfFits, setHalfFits] = useState(true)
  const preferredHeight = chosenHeight ?? half
  // Keep the half preference when a range or other timeline content temporarily uses its space.
  const height = preferredHeight === half && !halfFits ? peek : preferredHeight
  const replayVisible = height !== full
  const nextSnapFromPeek = halfFits ? half : full
  const sheet = useRef<HTMLElement>(null)
  const halfSizer = useRef<HTMLDivElement>(null)
  const drag = useRef<{ pointerId: number; y: number } | null>(null)

  useLayoutEffect(() => {
    if (!replayVisible) return
    const layout = sheet.current?.parentElement
    const timeline = layout?.querySelector(':scope > .battle-timeline')
    const sizer = halfSizer.current
    if (!layout || !timeline || !sizer) return

    const measure = () => {
      const timelineHeight = timeline.getBoundingClientRect().height
      const halfHeight = sizer.getBoundingClientRect().height
      if (timelineHeight > 0 && halfHeight > 0) {
        setHalfFits(layout.getBoundingClientRect().height - timelineHeight - halfHeight >= minimumMapHeight)
      }
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    for (const element of [layout, timeline, sizer]) observer.observe(element)
    return () => observer.disconnect()
  }, [replayVisible])

  function chooseHeight(next: SheetHeight) {
    setChosenHeight(next)
    try {
      localStorage.setItem(storageKey, String(next))
    } catch {
      // The choice still applies in the current view.
    }
  }

  function step(delta: number) {
    chooseHeight(delta > 0 ? height === peek ? nextSnapFromPeek : full : height === full ? half : peek)
  }

  function cycle() {
    chooseHeight(height === peek ? nextSnapFromPeek : height === half ? full : peek)
  }

  function handleKeys(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowUp': case 'ArrowRight': step(1); break
      case 'ArrowDown': case 'ArrowLeft': step(-1); break
      case 'Home': chooseHeight(peek); break
      case 'End': chooseHeight(full); break
      case 'Enter': case ' ': cycle(); break
      default: return
    }
    event.preventDefault()
  }

  function beginDrag(event: PointerEvent<HTMLDivElement>) {
    if (!event.isPrimary || event.button !== 0) return
    event.currentTarget.focus()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointerId: event.pointerId, y: event.clientY }
  }

  function endDrag(event: PointerEvent<HTMLDivElement>) {
    if (drag.current?.pointerId !== event.pointerId) return
    const distance = drag.current.y - event.clientY
    drag.current = null
    if (Math.abs(distance) >= 24) step(Math.sign(distance))
    else cycle()
  }

  return (
    <section ref={sheet} className="battle-sheet" data-height={height} aria-label="战斗数据">
      <div ref={halfSizer} className="battle-sheet-half-sizer" aria-hidden="true" />
      <div className="battle-sheet-grip" tabIndex={0} role="slider" aria-label="面板高度"
        aria-orientation="vertical" aria-valuemin={peek} aria-valuemax={full}
        aria-valuenow={height} aria-valuetext={heights[height]} onKeyDown={handleKeys}
        onPointerDown={beginDrag} onPointerUp={endDrag} onLostPointerCapture={() => { drag.current = null }} />
      <Tabs id={id} label="战斗数据" tabs={tabs} value={value} onChange={(tab) => {
        onChange(tab)
        if (height === peek) chooseHeight(half)
      }} />
      {tabs.map((tab) => {
        const active = tab.value === value
        return (
          <div key={tab.value} className="battle-sheet-content" role="tabpanel" id={`${id}-panel-${tab.value}`}
            aria-labelledby={`${id}-tab-${tab.value}`} hidden={!active || height === peek}>
            {active && children}
          </div>
        )
      })}
    </section>
  )
}
