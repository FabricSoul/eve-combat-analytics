// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { webcrypto } from 'node:crypto'
import { afterEach, expect, it, vi } from 'vitest'
import type { SideOverride, SideSubject } from '@/core/contract'
import type { BattleSnapshot } from '../../api/client'
import { BattleProvider } from '../../state/battle-store'
import { loadUiFixture } from '../../test/ui-fixture'
import { BattleUndo } from '../undo'
import { useSideMove } from './use-side-move'

const { summary, analysis } = loadUiFixture()
const subject = 'char:2121605780'
const other = 'corp:98108724'
const alliance = 'ally:1042504553'
const otherPilot = 'char:2115158138'
const first = { subject, side: 1, source: 'manual', setAt: 10_000 } satisfies SideOverride
const second = { ...first, side: 0, setAt: 11_300 }
const firstTag = '"side-first"'
const secondTag = '"side-second"'

function receipt(applied: SideOverride, previous: number, etag: string, previousTag: string | null) {
  return Response.json({
    ...applied, revision: etag,
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
      <button onClick={() => void move(other, 0)}>Corporation</button>
      <button onClick={() => void move(alliance, 1)}>Alliance</button>
      <button onClick={() => void move(subject, second.side)}>Second</button>
      <button onClick={() => void moveMany([{ subject, side: second.side }, { subject: other, side: 1 }])}>Batch</button>
      <button onClick={() => void moveMany([{ subject, side: -1 }, { subject: otherPilot, side: -1 }])}>Restore BR</button>
      {error && <p role="alert">{error}</p>}
    </>
  }
  const render = (analyzed: BattleSnapshot = summary) => act(() => root.render(
    <BattleProvider static={{ summary: analyzed, analysis }}>
      <BattleUndo analyzedSummary={analyzed}><Probe /></BattleUndo>
    </BattleProvider>,
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
    .mockResolvedValueOnce(Response.json({ applied: [], revision: '"restored"' }))
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

it.each<{ mode: string; weak: boolean; external: SideSubject }>([
  { mode: 'strong', weak: false, external: otherPilot },
  { mode: 'weak', weak: true, external: otherPilot },
  { mode: 'strong', weak: false, external: subject },
  { mode: 'weak', weak: true, external: subject },
])('keeps undo available per subject with $mode ETags when another editor changes $external', async ({ weak, external }) => {
  const externalName = summary.meta.names[Number(external.split(':')[1])]!.name
  const surviving = external === subject ? otherPilot : subject
  const prior = { ...first, side: 2 }
  const otherPrior: SideOverride = { ...first, subject: otherPilot }
  const headers = (revision: string) => ({ headers: { ETag: weak ? `W/${revision}` : revision } })
  const expected = surviving === subject ? prior : otherPrior
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({
      ...first, revision: firstTag, sequence: 3, previous: [{ subject, side: prior.side }],
      previousTags: { [subject]: '"prior"' },
    }, headers(firstTag)))
    .mockResolvedValueOnce(Response.json({
      applied: [first, otherPrior].map((row) => ({ ...row, side: -1 })), revision: secondTag, sequence: 4,
      previous: [first, otherPrior], previousTags: { [subject]: firstTag, [otherPilot]: '"other-prior"' },
    }, headers(secondTag)))
    .mockResolvedValueOnce(Response.json({ applied: [expected], revision: '"restored"', sequence: 6 }, headers('"restored"')))
  const app = await mount()
  try {
    await app.render({ ...summary, sideOverrides: [prior, otherPrior] })
    await app.move('First')
    await app.move('Restore BR')
    const notices = app.host.querySelectorAll('[data-battle-toast]')
    const older = notices[0]!
    const batch = notices[1]!
    const externalEdit = { ...first, subject: external, side: 0 }
    await app.render({ ...summary, sideOverrides: [externalEdit], editRevisions: [
      { target: `side:${external}`, revision: '"external"', sequence: 5 },
    ] })
    expect(older.querySelector('button') !== null).toBe(external !== subject)
    expect(batch.querySelector('button')).not.toBeNull()
    expect(batch.textContent).toContain(`${externalName} 已被他人修改，其余可撤销`)
    // A hovered notice can outlive the server's recent revision window.
    await app.render({ ...summary, sideOverrides: [externalEdit], editRevisions: [] })
    await act(async () => (surviving === subject ? older : batch).querySelector('button')!.click())
    const request = fetch.mock.calls[2]?.[1]
    expect(new Headers(request?.headers).get('If-Match')).toBe(secondTag)
    expect(JSON.parse(String(request?.body))).toEqual({
      restore: [{ subject: surviving, through: surviving === subject ? firstTag : secondTag }],
    })
    expect(app.buttons()).toHaveLength(0)
    expect(app.host.textContent).toContain(externalName)
  } finally {
    await app.unmount()
  }
})

it('retries the eligible batch subjects when a competing write reaches the Worker before its live frame', async () => {
  const otherPrior = { ...first, subject: otherPilot }
  const externalName = summary.meta.names[Number(otherPilot.split(':')[1])]!.name
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({
      applied: [first, otherPrior].map((row) => ({ ...row, side: -1 })), revision: secondTag, sequence: 4,
      previous: [first, otherPrior], previousTags: { [subject]: null, [otherPilot]: null },
    }))
    .mockResolvedValueOnce(Response.json({ error: 'bad_request' }, { status: 412 }))
    .mockResolvedValueOnce(Response.json({ ...summary, editRevisions: [
      { target: `side:${otherPilot}`, revision: '"external"', sequence: 5 },
    ] }))
    .mockResolvedValueOnce(Response.json({ applied: [first], revision: '"restored"', sequence: 6 }))
  const app = await mount()
  try {
    await app.move('Restore BR')
    await act(async () => app.buttons()[0]!.click())
    expect(fetch.mock.calls[2]?.[0]).toBe(`/api/battles/${summary.meta.brId}`)
    expect(JSON.parse(String(fetch.mock.calls[3]?.[1]?.body))).toEqual({ restore: [{ subject, through: secondTag }] })
    expect(app.host.textContent).toContain(`已撤销 · ${externalName} 已被他人修改，无法撤销`)
  } finally {
    await app.unmount()
  }
})

it('names both conflicting subjects when the last eligible batch subject changes during undo', async () => {
  const otherPrior = { ...first, subject: otherPilot }
  const otherConflict = { target: `side:${otherPilot}`, revision: '"external-b"', sequence: 5 }
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({
      applied: [first, otherPrior].map((row) => ({ ...row, side: -1 })), revision: secondTag, sequence: 4,
      previous: [first, otherPrior], previousTags: { [subject]: null, [otherPilot]: null },
    }))
    .mockResolvedValueOnce(Response.json({ error: 'bad_request' }, { status: 412 }))
    .mockResolvedValueOnce(Response.json({ ...summary, editRevisions: [
      otherConflict, { target: `side:${subject}`, revision: '"external-a"', sequence: 6 },
    ] }))
  const app = await mount()
  try {
    await app.move('Restore BR')
    await app.render({ ...summary, editRevisions: [otherConflict] })
    await act(async () => app.buttons()[0]!.click())
    expect(fetch).toHaveBeenCalledTimes(3)
    expect(app.host.textContent).toContain('Blanchard2213、dock Yanumano 已被他人修改，无法撤销')
    expect(app.buttons()).toHaveLength(0)
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

it('uses the conditional restore when a newer same-target frame has not arrived', async () => {
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
      applied: [second, otherMove], revision: secondTag,
      previous: [{ subject, side: -1 }, { subject: other, side: -1 }],
      previousTags: { [subject]: null, [other]: null },
    }, { headers: { ETag: secondTag } }))
    .mockResolvedValueOnce(receipt(first, second.side, firstTag, secondTag))
    .mockResolvedValueOnce(Response.json({
      applied: [{ ...first, side: -1 }, { ...otherMove, side: -1 }], previous: [], revision: '"restored"',
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


it('undoes overlapping same-tab corporation and alliance edits through a single batch', async () => {
  vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) } })
  const sideReceipt = (subject: string, side: number, revision: string, related: string[]) => Response.json({
    subject, side, revision, related, previous: [{ subject, side: -1 }], previousTags: { [subject]: null },
  }, { headers: { ETag: `W/${revision}` } })
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(sideReceipt(other, 0, firstTag, [alliance]))
    .mockResolvedValueOnce(sideReceipt(alliance, 1, secondTag, [other]))
    .mockResolvedValueOnce(Response.json({ applied: [], revision: '"restored"' }))
  const app = await mount()
  try {
    await app.move('Corporation')
    await app.move('Alliance')
    await act(async () => app.buttons()[0]!.click())
    expect(JSON.parse(String(fetch.mock.calls[2]?.[1]?.body)).restore).toEqual(expect.arrayContaining([
      { subject: other, through: firstTag }, { subject: alliance, through: secondTag },
    ]))
    expect(app.host.textContent).toContain('撤销了 2 次修改')
  } finally {
    await app.unmount()
  }
})

it('keeps a side undo through unrelated edits and withdraws it as soon as that subject is removed', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({
    ...first, revision: firstTag, sequence: 2,
    previous: [{ subject, side: -1 }], previousTags: { [subject]: null },
  }))
  const app = await mount()
  try {
    await app.move('First')
    await app.render({ ...summary, sideOverrides: [first], editRevisions: [
      { target: `side:${subject}`, revision: `W/${firstTag}`, sequence: 2 },
      { target: `side:${other}`, revision: secondTag, sequence: 3 },
    ] })
    expect(app.buttons()).toHaveLength(1)
    await app.render({ ...summary, sideOverrides: [], editRevisions: [
      { target: `side:${subject}`, revision: '"removed"', sequence: 4 },
    ] })
    expect(app.buttons()).toHaveLength(0)
    expect(app.host.textContent).toContain('阵营划分已被其他编辑更改，无法撤销')
    expect(fetch).toHaveBeenCalledTimes(1)
  } finally {
    await app.unmount()
  }
})

it('provides feedback for an assignment that needs no change', async () => {
  vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(Response.json({ ...first, revision: null }))
  const app = await mount()
  try {
    await app.move('First')
    expect(app.host.textContent).toContain('阵营划分没有变化')
    expect(app.buttons()).toHaveLength(0)
  } finally {
    await app.unmount()
  }
})

it('restores the original group if a linked group was overtaken before its live frame arrived', async () => {
  vi.stubGlobal('crypto', { subtle: { digest: vi.fn().mockResolvedValue(new Uint8Array(32).buffer) } })
  const fetch = vi.spyOn(globalThis, 'fetch')
    .mockResolvedValueOnce(Response.json({
      subject: other, side: 0, revision: firstTag, sequence: 1, related: [alliance],
      previous: [{ subject: other, side: -1 }], previousTags: { [other]: null },
    }))
    .mockResolvedValueOnce(Response.json({
      subject: alliance, side: 1, revision: secondTag, sequence: 2, related: [other],
      previous: [{ subject: alliance, side: -1 }], previousTags: { [alliance]: null },
    }))
    .mockResolvedValueOnce(Response.json({ error: 'bad_request', message: 'Side assignments have changed' }, { status: 412 }))
    .mockResolvedValueOnce(Response.json({ ...summary, editRevisions: [
      { target: `side:${alliance}`, revision: '"external"', sequence: 3 },
    ] }))
    .mockResolvedValueOnce(Response.json({ applied: [], revision: '"restored"', sequence: 4 }))
  const app = await mount()
  try {
    await app.move('Corporation')
    await app.move('Alliance')
    await act(async () => app.buttons()[0]!.click())
    expect(fetch).toHaveBeenCalledTimes(5)
    expect(JSON.parse(String(fetch.mock.calls[4]?.[1]?.body))).toEqual({ restore: [{ subject: other, through: firstTag }] })
    expect(app.host.textContent).toContain('已撤销')
  } finally {
    await app.unmount()
  }
})
