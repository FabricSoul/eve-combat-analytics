import type { Rect } from './placement'

export function watchLabelObstacles(stage: HTMLElement, changed: () => void) {
  const header = stage.querySelector('.replay-header')
  const resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(changed)
  const panelStyles = new MutationObserver(changed)
  let obstacles: Element[] = []

  function watch() {
    resize?.disconnect()
    resize?.observe(stage)
    if (header) resize?.observe(header)
    panelStyles.disconnect()
    const controls = [...stage.querySelectorAll('.replay-control-trigger, .replay-noise summary, .replay-zoom')]
    const panels = controls.flatMap((control) => {
      const id = control.getAttribute('aria-controls')
      const panel = id && document.getElementById(id)
      return panel ? [panel] : []
    })
    obstacles = [...controls, ...panels]
    for (const element of obstacles) resize?.observe(element)
    // Floating windows move using inline styles, which need not resize the window.
    for (const panel of panels) panelStyles.observe(panel, { attributes: true, attributeFilter: ['style'] })
  }

  const headerChanges = new MutationObserver(() => {
    watch()
    changed()
  })
  if (header) headerChanges.observe(header, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-controls'] })
  watch()
  window.addEventListener('scroll', changed, true)

  return {
    measure(): Rect[] {
      const origin = stage.getBoundingClientRect()
      return obstacles.flatMap((element) => {
        const { left, top, width, height } = element.getBoundingClientRect()
        return width > 0 && height > 0 ? [{ x: left - origin.left, y: top - origin.top, width, height }] : []
      })
    },
    disconnect() {
      resize?.disconnect()
      panelStyles.disconnect()
      headerChanges.disconnect()
      window.removeEventListener('scroll', changed, true)
    },
  }
}
