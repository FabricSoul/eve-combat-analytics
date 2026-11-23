// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

const loadBattle = vi.hoisted(() => vi.fn())
vi.mock('./battle/BattlePage.tsx', () => {
  loadBattle()
  return { BattlePage: ({ brId }: { brId: string }) => <p>{brId}</p> }
})

it('loads the battle route only after navigating away from home', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    window.history.replaceState(null, '', '/')
    const { App } = await import('./App')
    await act(async () => root.render(<App />))
    expect(host.querySelector('[aria-label="BR 链接"]')).not.toBeNull()
    expect(loadBattle).not.toHaveBeenCalled()

    await act(async () => {
      window.history.pushState(null, '', '/b/example')
      window.dispatchEvent(new PopStateEvent('popstate'))
    })
    await act(async () => vi.dynamicImportSettled())
    expect(loadBattle).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('example')
  } finally {
    act(() => root.unmount())
    window.history.replaceState(null, '', '/')
    vi.unstubAllGlobals()
  }
})
