// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { watchLabelObstacles } from './label-obstacles'

it('tracks a replay window when its portal replaces the element without changing its ID', async () => {
  const workspace = document.createElement('div')
  workspace.className = 'battle-layout'
  const stage = document.createElement('div')
  const trigger = document.createElement('button')
  trigger.className = 'replay-control-trigger'
  trigger.setAttribute('aria-controls', 'replay-window')
  stage.appendChild(trigger)
  const portal = document.createElement('div')
  portal.className = 'battle-replay-layer'
  workspace.appendChild(stage)
  workspace.appendChild(portal)
  document.body.appendChild(workspace)

  const panel = document.createElement('div')
  panel.id = 'replay-window'
  document.body.appendChild(panel)
  const changed = vi.fn()
  const obstacles = watchLabelObstacles(stage, changed)
  try {
    const replacement = panel.cloneNode() as HTMLDivElement
    vi.spyOn(replacement, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 120, 240, 160))
    panel.remove()
    portal.appendChild(replacement)
    await Promise.resolve()

    expect(changed).toHaveBeenCalled()
    expect(obstacles.measure()).toEqual([{ x: 100, y: 120, width: 240, height: 160 }])

    changed.mockClear()
    replacement.style.left = '200px'
    await Promise.resolve()
    expect(changed).toHaveBeenCalled()
  } finally {
    obstacles.disconnect()
    workspace.remove()
    panel.remove()
  }
})
