import { useCallback, useRef, useState } from 'react'
import type { FocusEvent, KeyboardEvent } from 'react'
import type { EntityKey } from '@/core/contract'

export interface ReplayFocusTarget {
  key: EntityKey
  button: HTMLButtonElement
}

export function useReplayKeyboard() {
  const toolbar = useRef<HTMLDivElement>(null)
  const targets = useRef<ReplayFocusTarget[]>([])
  const tabStop = useRef<ReplayFocusTarget | undefined>(undefined)
  const [focused, setFocused] = useState<EntityKey | null>(null)

  const setTabStop = useCallback((next: ReplayFocusTarget | undefined) => {
    if (tabStop.current?.button !== next?.button) {
      if (tabStop.current) tabStop.current.button.tabIndex = -1
      if (next) next.button.tabIndex = 0
      tabStop.current = next
    }
  }, [])

  const updateTargets = useCallback((
    next: ReplayFocusTarget[], selected: EntityKey | null, previouslyFocused: Element | null,
  ) => {
    targets.current = next
    const toolbarElement = toolbar.current
    const current = next.find(({ button }) => button === previouslyFocused)
      ?? next.find(({ key }) => key === tabStop.current?.key)
      ?? next.find(({ key }) => key === selected)
      ?? next[0]
    setTabStop(current)

    // A disappearing marker becomes inert, so keep focus inside the canvas if it held it.
    if (previouslyFocused && previouslyFocused !== toolbarElement && toolbarElement?.contains(previouslyFocused)
      && !next.some(({ button }) => button === previouslyFocused)) {
      const fallback = current?.button ?? toolbarElement
      if (fallback !== previouslyFocused) fallback.focus({ preventScroll: true })
    }
  }, [setTabStop])

  function onFocus() {
    const target = targets.current.find(({ button }) => button === document.activeElement)
    if (target) setTabStop(target)
    setFocused(target?.key ?? null)
  }

  function onBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) setFocused(null)
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const current = targets.current
    if (!current.length || event.altKey || event.ctrlKey || event.metaKey) return
    const index = current.findIndex(({ button }) => button === event.target)
    if (event.key === 'Enter' && index >= 0) {
      event.preventDefault()
      if (!event.repeat) current[index]!.button.click()
      return
    }

    let next: ReplayFocusTarget | undefined
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = current[(index + 1) % current.length]
        break
      case 'ArrowLeft':
      case 'ArrowUp':
        next = current[(Math.max(index, 0) - 1 + current.length) % current.length]
        break
      case 'Home':
        next = current[0]
        break
      case 'End':
        next = current.at(-1)
        break
      default:
        return
    }
    event.preventDefault()
    next?.button.focus({ preventScroll: true })
  }

  return { toolbar, focused, updateTargets, onFocus, onBlur, onKeyDown }
}
