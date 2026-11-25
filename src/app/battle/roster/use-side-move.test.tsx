// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import type { SideOverride } from '@/core/contract'
import { loadUiFixture } from '../../test/ui-fixture'
import { BattleUndo } from '../undo'
import { useSideMove } from './use-side-move'

const { summary } = loadUiFixture()
const subject = 'char:2121605780'
const other = 'corp:98108724'
const first = { subject, side: 1, source: 'manual', setAt: 10_000 } satisfies SideOverride
const second = { ...first, side: 0, setAt: 11_300 }
const firstTag = '"side-first"'
const secondTag = '"side-second"'

function receipt(applied: SideOverride, previous: number, etag: string, previousTag: string | null) {
  return Response.json({
    ...applied,
    previous: [{ subject, side: previous }],
    previousTags: { [subject]: previousTag },
  }, { headers: { ETag: etag } })
}

async function mount() {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  vi.useFakeTimers()
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  function Probe() {
    const { move, moveMany, error } = useSideMove(summary.meta.brId, [], summary.analysisVersion)
    return <>
      <button onClick={() => void move(subject, first.side)}>First</button>
      <button onClick={() => void move(subject, second.side)}>Second</button>
      <button onClick={() => void moveMany([{ subject, side: second.side }, { subject: other, side: 1 }])}>Batch</button>
      {error && <p role="alert">{error}</p>}
    </>
  }
  const render = (analyzed = summary) => act(() => root.render(
    <BattleUndo analyzedSummary={analyzed}><Probe /></BattleUndo>,
  ))
  await render()
  return {
    host, render,
    move: (label: string) => act(async () => [...host.querySelectorAll('button')].find((b) => b.textContent === label)!.click()),
    buttons: () => [...host.querySelectorAll<HTMLButtonElement>('[data-battle-toast] button')],
    unmount: async () => { await act(() => root.unmount()); host.remove() },
  }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it('queues undo from the first moment and submits it after a response held past ten seconds', async () => {
  let settle!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { settle = resolve })
  const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(pending)
    .mockResolvedValueOnce(Response.json({ applied: [] }, { headers: { ETag: '"restored"' } }))
  const app = await mount()
  try {
    await app.move('First')
    expect(app.buttons()).toHaveLength(1)
    await act(async () => app.buttons()[0]!.click())
    expect(app.host.textContent).toContain('正在撤销…')
    expect(app.buttons()).toHaveLength(0)
    await act(() => vi.advanceTimersByTime(10_200))
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(app.host.textContent).toContain('正在撤销…')
    await act(async () => settle(receipt(first, -1, firstTag, null)))
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('If-Match')).toBe(firstTag)
    expect(app.host.textContent).toContain('已撤销')
  } finally {
    await app.unmount()
  }
})

it('renders the side limit error in Chinese even when the API responds in English', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
    error: 'bad_request', message: 'A battle can accept at most 30 side edits per minute',
  }, { status: 429 }))
  const app = await mount()
  try {
    await app.move('First')
    expect(app.host.querySelector('[role="alert"]')?.textContent).toBe('每分钟最多改 30 次排边，请稍后再试')
  } finally {
    await app.unmount()
  }
})

it('offers undo on HTTP success even when only the overtaking side edit reaches analysis', async () => {
  let settle!: () => void
  const save = new Promise<Response>((resolve) => { settle = () => resolve(receipt(first, -1, firstTag, null)) })
  const fetch = vi.spyOn(globalThis, 'fetch').mockReturnValueOnce(save)
    .mockResolvedValueOnce(Response.json({ error: 'bad_request', message: 'Side assignments have changed' }, { status: 412 }))
  const app = await mount()
  try {
    await app.move('First')
    expect(app.host.textContent).toContain('正在应用…')
    await app.render({ ...summary, sideOverrides: [second], analysisVersion: summary.analysisVersion + 1 })
    await act(async () => settle())
    expect(app.buttons()).toHaveLength(1)
    expect(app.host.textContent).not.toContain('正在应用…')
    await act(async () => app.buttons()[0]!.click())
    expect(new Headers(fetch.mock.calls[1]?.[1]?.headers).get('If-Match')).toBe(firstTag)
    expect(app.host.textContent).toContain('阵营划分已被其他编辑更改，无法撤销')
  } finally {
    await app.unmount()
  }
})

it('undoes both own side moves from the older toast without an intervening publication', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(receipt(first, -1, firstTag, null))
    .mockResolvedValueOnce(receipt(second, first.side, secondTag, firstTag))
    .mockResolvedValueOnce(receipt({ ...second, side: -1 }, second.side, '"restored"', secondTag))
  const app = await mount()
  try {
    await app.move('First')
    await act(() => vi.advanceTimersByTime(1300))
    await app.move('Second')
    expect(app.buttons()).toHaveLength(2)
    await act(async () => app.buttons()[0]!.click())
    expect(new Headers(fetch.mock.calls[2]?.[1]?.headers).get('If-Match')).toBe(secondTag)
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body))).toEqual({ restore: [{ subject, through: firstTag }] })
    expect(app.host.textContent).toContain('撤销了 2 次修改')
    expect(app.buttons()).toHaveLength(0)
  } finally {
    await app.unmount()
  }
})

it('atomically undoes a batch and a subsequent move using both current subject validators', async () => {
  const entries = JSON.stringify([[subject, firstTag], [other, secondTag]])
  const expected = await webcrypto.subtle.digest('SHA-256', new TextEncoder().encode(entries))
  const digest = vi.fn(async () => expected)
  vi.stubGlobal('crypto', { subtle: { digest } })
  const otherMove = { ...first, subject: other }
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({
      applied: [second, otherMove],
      previous: [{ subject, side: -1 }, { subject: other, side: -1 }],
      previousTags: { [subject]: null, [other]: null },
    }, { headers: { ETag: secondTag } }))
    .mockResolvedValueOnce(receipt(first, second.side, firstTag, secondTag))
    .mockResolvedValueOnce(Response.json({
      applied: [{ ...first, side: -1 }, { ...otherMove, side: -1 }], previous: [],
    }, { headers: { ETag: '"restored"' } }))
  const app = await mount()
  try {
    await app.move('Batch')
    await app.move('First')
    await act(async () => app.buttons()[0]!.click())
    const [path, request] = fetch.mock.calls[2]!
    expect(path).toMatch(/\/sides\/batch$/)
    expect(digest).toHaveBeenCalledWith('SHA-256', new TextEncoder().encode(entries))
    expect(new Headers(request?.headers).get('If-Match')).toBe(`"${Buffer.from(expected).toString('hex')}"`)
    expect(JSON.parse(String(request?.body)).restore).toEqual([{ subject, through: secondTag }, { subject: other, through: secondTag }])
    expect(app.host.textContent).toContain('撤销了 2 次修改')
    expect(app.buttons()).toHaveLength(0)
  } finally {
    await app.unmount()
  }
})
