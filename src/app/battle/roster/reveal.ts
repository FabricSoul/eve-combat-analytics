/** The nearest ancestor that scrolls vertically: the list a row lives in. */
export function scroller(element: HTMLElement): HTMLElement | null {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node)
    if (overflowY === 'auto' || overflowY === 'scroll') return node
  }
  return null
}

/** Scroll `element` into view inside its own list only (never the surrounding module area); `inset` leaves room for a sticky header. */
export function revealInList(element: HTMLElement, inset = 0): void {
  const list = scroller(element)
  if (!list) return
  const box = list.getBoundingClientRect()
  const row = element.getBoundingClientRect()
  if (row.top < box.top + inset) list.scrollTop += row.top - box.top - inset
  else if (row.bottom > box.bottom) list.scrollTop += row.bottom - box.bottom
}

/** Hide only the leading row cut by a sticky roster heading, preserving scroll geometry. */
export function hidePartialRosterRow(roster: HTMLElement) {
  const list = scroller(roster)
  if (!list) return
  let clipped: Element | null = null
  const update = () => {
    const top = list.getBoundingClientRect().top + list.clientTop
    const heading = Array.from(roster.querySelectorAll('.roster-head')).find((head) => {
      const bounds = head.getBoundingClientRect()
      return bounds.top <= top + 0.5 && bounds.bottom > top
    })
    let partial: Element | null = null
    if (heading) {
      const edge = heading.getBoundingClientRect().bottom
      for (let row = heading.nextElementSibling; row; row = row.nextElementSibling) {
        const bounds = row.getBoundingClientRect()
        if (bounds.top >= edge) break
        if (bounds.bottom > edge) {
          partial = row
          break
        }
      }
    }
    if (partial === clipped) return
    clipped?.removeAttribute('data-roster-partial')
    partial?.setAttribute('data-roster-partial', '')
    clipped = partial
  }
  update()
  list.addEventListener('scroll', update, { passive: true })
  return () => {
    list.removeEventListener('scroll', update)
    clipped?.removeAttribute('data-roster-partial')
  }
}
