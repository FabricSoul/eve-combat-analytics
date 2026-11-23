import { useEffect, useRef } from 'react'
import type { SideSubject } from '@/core/contract'
import { sideColor } from '../../lib/sides'
import { sideName } from './model'

export interface SideMenuSection {
  heading: string
  subject: SideSubject
  /** Side the subject sits on now (hidden from its own list); omitted when it spans several. */
  current?: number
}

export interface SideMenuProps {
  /** Where the menu opens, viewport pixels. */
  x: number
  y: number
  sections: readonly SideMenuSection[]
  /** sideOrder(): every side a subject can move to. */
  order: readonly number[]
  /** Offer 新建一方 as a target. */
  newSide?: number
  onMove(subject: SideSubject, side: number): void
  onClose(): void
}

/** Row menu: the keyboard and right-click way to do what dragging does. */
export function SideMenu({ x, y, sections, order, newSide, onMove, onClose }: SideMenuProps) {
  const root = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const items = () => [...root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []]
    items()[0]?.focus()
    function outside(event: PointerEvent) {
      if (!root.current?.contains(event.target as Node)) onClose()
    }
    document.addEventListener('pointerdown', outside)
    return () => document.removeEventListener('pointerdown', outside)
  }, [onClose])

  function keys(event: React.KeyboardEvent) {
    const items = [...root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []]
    const index = items.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      onClose()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      items[(index + step + items.length) % items.length]?.focus()
    } else if (event.key === 'Tab') onClose()
  }

  const left = Math.max(0, Math.min(x, window.innerWidth - 248))
  const top = Math.max(0, Math.min(y, window.innerHeight - 40))
  return (
    <div ref={root} className="side-menu" role="menu" aria-label="移到…" style={{ left, top }} onKeyDown={keys}>
      {sections.map(({ heading, subject, current }) => (
        <div key={subject} role="group" aria-label={heading}>
          <div className="side-menu-head">{heading}</div>
          {order.filter((side) => side !== current).map((side) => (
            <button key={side} type="button" role="menuitem" className="side-menu-item"
              onClick={() => { onMove(subject, side); onClose() }}>
              <i className="side-dot" style={{ background: sideColor(side, order) }} aria-hidden="true" />
              移到{sideName(side, order)}
            </button>
          ))}
          {newSide !== undefined && (
            <button type="button" role="menuitem" className="side-menu-item"
              onClick={() => { onMove(subject, newSide); onClose() }}>
              <i className="side-dot" aria-hidden="true" />移到新建的一方
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
