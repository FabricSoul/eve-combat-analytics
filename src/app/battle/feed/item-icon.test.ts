// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { loadItemTypes, resetItemTypes, setItemTypesImporter, useModuleTypeId } from './item-icon'

afterEach(() => { resetItemTypes(); vi.unstubAllGlobals() })

describe('item type table loading', () => {
  it('a failed chunk download is reported to the caller, not left as an unhandled rejection, and can be retried', async () => {
    let attempt = 0
    setItemTypesImporter(() => {
      attempt++
      return attempt === 1 ? Promise.reject(new Error('chunk failed')) : Promise.resolve({ itemTypeId: (name: string) => name === 'X' ? 7 : null })
    })
    await expect(loadItemTypes()).rejects.toThrow('chunk failed')
    const lookup = await loadItemTypes()
    expect(lookup('X')).toBe(7)
    expect(attempt).toBe(2)
    expect(await loadItemTypes()).toBe(lookup) // cached after success
    expect(attempt).toBe(2)
  })

  it('the hook keeps answering null (text fallback) while the load fails and retries on the next mount', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    let attempt = 0
    setItemTypesImporter(() => ++attempt === 1 ? Promise.reject(new Error('offline')) : Promise.resolve({ itemTypeId: () => 42 }))
    const results: (number | null)[] = []
    function Probe() {
      results.push(useModuleTypeId()('Anything'))
      return null
    }
    const mountOnce = async () => {
      const container = document.createElement('div')
      const root = createRoot(container)
      await act(async () => { root.render(createElement(Probe)) })
      await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
      act(() => root.unmount())
    }
    await mountOnce()
    expect(results.every((r) => r === null)).toBe(true)
    await mountOnce()
    expect(results.at(-1)).toBe(42)
  })
})
