// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'
import { App } from '../App'

it('uses the approved Chinese title and puts the GitHub link next to the theme toggle on home', () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  try {
    window.history.replaceState(null, '', '/')
    act(() => root.render(<App />))
    const bar = host.querySelector('.app-topbar')!
    expect(bar.querySelector('.app-topbar-title')?.textContent).toBe('EVE 舰队战复盘')
    const github = bar.querySelector('a[href="https://github.com/FabricSoul/eve-combat-analytics"]')
    expect(github?.textContent).toBe('GitHub')
    expect(github?.nextElementSibling?.getAttribute('aria-label')).toMatch(/^切换到/)
  } finally {
    act(() => root.unmount())
    host.remove()
    vi.unstubAllGlobals()
  }
})
