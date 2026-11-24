import { useEffect, useLayoutEffect, useRef, useState } from 'react'
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
  /** Where the menu opens, viewport pixels: x and the bottom edge of what opened it. */
  x: number
  y: number
  /** Top edge of what opened it: the menu opens above it when there is no room below. Defaults to y. */
  anchorTop?: number
  /** Where focus goes when the menu closes; defaults to whatever had focus when it opened. */
  returnFocus?: HTMLElement | null
  sections: readonly SideMenuSection[]
  /** sideOrder(): every side a subject can move to. */
  order: readonly number[]
  /** Offer 新建一方 as a target. */
  newSide?: number
  pinAction?: { label: string; run(): void }
  /** Further plain items after the move sections. */
  actions?: readonly { label: string; run(): void }[]
  onMove(subject: SideSubject, side: number): void
  onClose(): void
}

/** Row menu: the keyboard and right-click way to do what dragging does. */
const edge = 8

export function SideMenu({ x, y, anchorTop = y, returnFocus, sections, order, newSide, pinAction, actions = [], onMove, onClose }: SideMenuProps) {
  const root = useRef<HTMLDivElement>(null)
  const [invoker] = useState(() => returnFocus ?? (document.activeElement instanceof HTMLElement ? document.activeElement : null))
  const [place, setPlace] = useState({ left: x, top: y, maxHeight: window.innerHeight - 2 * edge })

  // Size and flip by measured bounds: below the anchor if it fits, else above, else as high as the viewport allows.
  useLayoutEffect(() => {
    const menu = root.current
    if (!menu) return
    const maxHeight = Math.max(80, window.innerHeight - 2 * edge)
    const height = Math.min(menu.scrollHeight, maxHeight)
    const width = menu.offsetWidth || 232
    const top = height <= window.innerHeight - edge - y ? y
      : height <= anchorTop - edge ? anchorTop - height
        : Math.max(edge, window.innerHeight - edge - height)
    setPlace({ left: Math.max(edge, Math.min(x, window.innerWidth - width - edge)), top, maxHeight })
  }, [x, y, anchorTop, sections.length])

  useEffect(() => () => { if (invoker?.isConnected) invoker.focus() }, [invoker])

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
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault()
      items[event.key === 'Home' ? 0 : items.length - 1]?.focus()
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const step = event.key === 'ArrowDown' ? 1 : -1
      items[(index + step + items.length) % items.length]?.focus()
    } else if (event.key === 'Tab') onClose()
  }

  return (
    <div ref={root} className="side-menu" role="menu" aria-label={pinAction || actions.length ? '飞行员操作' : '移到…'} onKeyDown={keys}
      style={{ left: place.left, top: place.top, maxHeight: place.maxHeight, overflowY: 'auto' }}>
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
      {actions.map(({ label, run }) => <button key={label} type="button" role="menuitem" className="side-menu-item"
        onClick={() => { run(); onClose() }}>{label}</button>)}
      {pinAction && <button type="button" role="menuitem" className="side-menu-item"
        onClick={() => { pinAction.run(); onClose() }}>{pinAction.label}</button>}
    </div>
  )
}
