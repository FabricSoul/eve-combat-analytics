// @vitest-environment jsdom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api, ApiFailure } from '../api/client'
import { HomePage } from './HomePage'
import { readRecent } from './recent'

let root: Root | undefined
let host: HTMLElement
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true })
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); window.history.replaceState(null, '', '/') })
afterEach(() => { act(() => root?.unmount()); host?.remove() })

function mount() {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(<HomePage />))
}

function type(value: string) {
  const input = host.querySelector<HTMLInputElement>('input')!
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  act(() => { set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })) })
}
const submit = () => act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
const id = '6b035d82a6d97f0534b7e73b'

describe('HomePage', () => {
  it('shows a Chinese error for an unrecognised link and does not call the API', async () => {
    const create = vi.spyOn(api, 'createBattle')
    mount()
    type('not a link')
    await submit()
    expect(create).not.toHaveBeenCalled()
    expect(host.querySelector('[role="alert"]')!.textContent).toMatch(/链接/)
  })

  it('navigates as soon as createBattle succeeds, without waiting for a summary fetch (R2a-8)', async () => {
    vi.spyOn(api, 'createBattle').mockResolvedValue({ brId: id })
    const summary = vi.spyOn(api, 'getBattle').mockReturnValue(new Promise(() => undefined))
    const navigated = vi.fn()
    window.addEventListener('popstate', navigated)
    mount()
    type(`https://br.evetools.org/br/${id}`)
    await submit()
    expect(api.createBattle).toHaveBeenCalledWith(`https://br.evetools.org/br/${id}`)
    expect(summary).not.toHaveBeenCalled()
    expect(window.location.pathname).toBe(`/b/${id}`)
    expect(navigated).toHaveBeenCalled()
    window.removeEventListener('popstate', navigated)
  })

  it('does not invent metadata for a battle it only knows by id (R2a-8)', async () => {
    vi.spyOn(api, 'createBattle').mockResolvedValue({ brId: id })
    mount()
    type(id)
    await submit()
    const entry = readRecent()[0]!
    expect(entry.brId).toBe(id)
    expect(entry.start).toBeUndefined()
    expect(entry.kills).toBeUndefined()
    act(() => root!.unmount())
    host.remove()
    mount()
    const row = host.querySelector('a.home-recent-row')!
    expect(row.textContent).not.toMatch(/1970|次击毁|日志/)
  })

  it('keeps known metadata when the same battle is opened again (R2a-8)', async () => {
    localStorage.setItem('eve-combat-analytics:recent', JSON.stringify([
      { brId: id, title: 'J125990', start: 1750606047000, end: 1750610857000, kills: 52, logs: 17, openedAt: 5 },
    ]))
    vi.spyOn(api, 'createBattle').mockResolvedValue({ brId: id })
    mount()
    type(id)
    await submit()
    expect(readRecent()[0]).toMatchObject({ title: 'J125990', kills: 52, logs: 17 })
    expect(readRecent()[0]!.openedAt).toBeGreaterThan(5)
  })

  it('does not navigate from a stale create after the user clicked another recent battle (R2a-8)', async () => {
    localStorage.setItem('eve-combat-analytics:recent', JSON.stringify([
      { brId: 'other', title: 'Other', start: 1, end: 2, kills: 1, logs: 0, openedAt: 5 },
    ]))
    let resolve!: (value: { brId: string }) => void
    vi.spyOn(api, 'createBattle').mockReturnValue(new Promise((done) => { resolve = done }))
    mount()
    type(id)
    const pending = submit()
    act(() => { host.querySelector<HTMLAnchorElement>('a.home-recent-row')!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 })) })
    expect(window.location.pathname).toBe('/b/other')
    await act(async () => { resolve({ brId: id }) })
    await pending
    expect(window.location.pathname).toBe('/b/other')
    expect(readRecent().some(({ brId }) => brId === id)).toBe(false)
  })

  it.each([
    ['br_not_found', '没有找到'],
    ['br_unavailable', '暂时无法访问'],
    ['bad_br_url', '不是可识别'],
  ] as const)('shows %s under the input', async (code, text) => {
    vi.spyOn(api, 'createBattle').mockRejectedValue(new ApiFailure(code, 'raw'))
    mount()
    type(id)
    await submit()
    expect(host.querySelector('[role="alert"]')!.textContent).toContain(text)
    expect(window.location.pathname).toBe('/')
  })

  it('lists recent battles from localStorage and works when storage throws', () => {
    localStorage.setItem('eve-combat-analytics:recent', JSON.stringify([
      { brId: id, title: 'J125990', start: 1750606047000, end: 1750610857000, kills: 52, logs: 17, openedAt: 5 },
    ]))
    mount()
    const link = host.querySelector<HTMLAnchorElement>('a.home-recent-row')!
    expect(link.getAttribute('href')).toBe(`/b/${id}`)
    expect(link.textContent).toContain('J125990')
    expect(link.textContent).toContain('52')
    act(() => root!.unmount())
    host.remove()
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied') })
    mount()
    expect(host.querySelector('a.home-recent-row')).toBeNull()
    expect(host.querySelector('input')).not.toBeNull()
  })
})
