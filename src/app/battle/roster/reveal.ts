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
