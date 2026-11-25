import { useLayoutEffect, type RefObject } from 'react'

const expandedSurface = ':is(.u7-compare, .hit-analysis, .kills, .u7-person)[data-expanded="true"]'
const closeControl = '[data-full-page-close]'

function coveredBranches(root: HTMLElement, foreground: HTMLElement[]) {
  const covered = new Set<HTMLElement>()
  function visit(parent: HTMLElement) {
    for (const child of parent.children) {
      if (!(child instanceof HTMLElement) || foreground.includes(child)) continue
      if (foreground.some((surface) => child.contains(surface))) visit(child)
      else covered.add(child)
    }
  }
  visit(root)
  return covered
}

export function useFullPageWorkspace(desk: RefObject<HTMLDivElement | null>, ready: boolean) {
  useLayoutEffect(() => {
    const root = desk.current
    if (!ready || !root) return

    let foreground: HTMLElement | undefined
    let inert = new Set<HTMLElement>()
    const openers = new Map<HTMLElement, HTMLElement>()
    let clicked: HTMLElement | null = null
    let clearClick: ReturnType<typeof setTimeout> | undefined

    // Capture the title-bar trigger before Compare and Hits forward the click to their own button.
    function recordClick(event: MouseEvent) {
      const target = event.target instanceof Element && event.target.closest<HTMLElement>('[data-full-page-open]')
      if (!target || (clicked && !event.isTrusted)) return
      clicked = target
      clearTimeout(clearClick)
      clearClick = setTimeout(() => { clicked = null }, 0)
    }

    function update() {
      if (!root) return
      const expanded = [...root.querySelectorAll<HTMLElement>(expandedSurface)].filter((el) => !el.closest('[hidden]'))
      const active = expanded.at(-1)
      const closingOpener = foreground && !expanded.includes(foreground) ? openers.get(foreground) : undefined
      for (const surface of openers.keys()) {
        if (!expanded.includes(surface)) openers.delete(surface)
      }
      if (active && active !== foreground && clicked) openers.set(active, clicked)
      const keep = active ? [active] : []
      if (active) {
        // These surfaces can open on top of a full-page module.
        keep.push(...root.querySelectorAll<HTMLElement>(':scope > :is(.battle-drawer, .battle-person-page, .battle-sides)'))
      }
      const covered = active ? coveredBranches(root, keep) : new Set<HTMLElement>()
      for (const el of inert) {
        if (!covered.has(el)) el.removeAttribute('inert')
      }
      inert = new Set([...covered].filter((el) => inert.has(el) || !el.hasAttribute('inert')))
      for (const el of inert) {
        if (!el.hasAttribute('inert')) el.setAttribute('inert', '')
      }

      if (closingOpener?.isConnected && !closingOpener.closest('[inert]')) closingOpener.focus({ preventScroll: true })
      else if (active && active !== foreground) active.querySelector<HTMLElement>(closeControl)?.focus({ preventScroll: true })
      foreground = active
    }

    const observer = new MutationObserver((changes) => {
      if (foreground || changes.some(({ attributeName }) => attributeName === 'data-expanded')) update()
    })
    observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ['data-expanded', 'hidden'] })
    root.addEventListener('click', recordClick, true)
    update()
    return () => {
      clearTimeout(clearClick)
      observer.disconnect()
      root.removeEventListener('click', recordClick, true)
      for (const el of inert) el.removeAttribute('inert')
    }
  }, [desk, ready])
}
