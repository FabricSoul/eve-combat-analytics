// @vitest-environment jsdom
import { expect, it, vi } from 'vitest'
import { watchLabelObstacles } from './label-obstacles'

it('tracks the replay pilot picker and custom header controls as label obstacles', async () => {
  const workspace = document.createElement('div')
  workspace.className = 'battle-layout'
  workspace.innerHTML = `<div class="replay-stage"><div class="replay-header">
    <div class="replay-header-actions"><button>Option</button></div></div></div>
    <div class="battle-replay-popover-layer"></div>`
  document.body.appendChild(workspace)
  const stage = workspace.querySelector<HTMLElement>('.replay-stage')!
  const control = workspace.querySelector('button')!
  vi.spyOn(control, 'getBoundingClientRect').mockReturnValue(new DOMRect(10, 20, 40, 25))
  const changed = vi.fn()
  const obstacles = watchLabelObstacles(stage, changed)
  try {
    const layer = document.createElement('div')
    layer.className = 'replay-pilot-picker-layer'
    const picker = document.createElement('div')
    picker.className = 'replay-pilot-picker'
    vi.spyOn(picker, 'getBoundingClientRect').mockReturnValue(new DOMRect(100, 120, 250, 160))
    layer.appendChild(picker)
    workspace.querySelector('.battle-replay-popover-layer')!.appendChild(layer)
    await Promise.resolve()

    expect(changed).toHaveBeenCalled()
    expect(obstacles.measure()).toEqual([
      { x: 10, y: 20, width: 40, height: 25 },
      { x: 100, y: 120, width: 250, height: 160 },
    ])
  } finally {
    obstacles.disconnect()
    workspace.remove()
  }
})

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
