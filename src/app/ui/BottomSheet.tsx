import { useId, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Tabs, type TabOption } from './Tabs'

const heights = ['收起', '半屏', '全屏'] as const
const peek = 0
const half = 1
const full = 2

interface BottomSheetProps<T extends string> {
  tabs: readonly TabOption<T>[]
  value: T
  onChange(value: T): void
  children: ReactNode
}

export function BottomSheet<T extends string>({ tabs, value, onChange, children }: BottomSheetProps<T>) {
  const id = useId()
  const [height, setHeight] = useState(half)
  const drag = useRef<{ pointerId: number; y: number } | null>(null)

  function step(delta: number) {
    setHeight((current) => Math.max(peek, Math.min(full, current + delta)))
  }

  function handleKeys(event: KeyboardEvent) {
    switch (event.key) {
      case 'ArrowUp': case 'ArrowRight': step(1); break
      case 'ArrowDown': case 'ArrowLeft': step(-1); break
      case 'Home': setHeight(peek); break
      case 'End': setHeight(full); break
      case 'Enter': case ' ': setHeight((current) => (current + 1) % heights.length); break
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
    else setHeight((current) => (current + 1) % heights.length)
  }

  return (
    <section className="battle-sheet" data-height={height} aria-label="战斗数据">
      <div className="battle-sheet-grip" tabIndex={0} role="slider" aria-label="面板高度"
        aria-orientation="vertical" aria-valuemin={peek} aria-valuemax={full}
        aria-valuenow={height} aria-valuetext={heights[height]} onKeyDown={handleKeys}
        onPointerDown={beginDrag} onPointerUp={endDrag} onLostPointerCapture={() => { drag.current = null }} />
      <Tabs id={id} label="战斗数据" tabs={tabs} value={value} onChange={(tab) => {
        onChange(tab)
        if (height === peek) setHeight(half)
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
