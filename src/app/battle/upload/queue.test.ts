import { describe, expect, it, vi } from 'vitest'
import type { UploadedLogSummary } from '@/core/contract'
import { ApiFailure } from '../../api/client'
import { initialQueue, queueReducer, summarizeQueue, type QueueState } from './queue'
import { runUpload } from './runner'

const log: UploadedLogSummary = { id: 'abc', charId: 1, charName: 'Pilot', side: 0, events: 10, uploadedAt: 0, first: 1000, last: 2000, language: 'en' }
const add = (state: QueueState, ...names: string[]) =>
  queueReducer(state, { type: 'add', files: names.map((name) => ({ name, size: 100 })) })

describe('upload queue state machine', () => {
  it('walks queued → uploading → parsing → done', () => {
    let state = add(initialQueue, 'a.txt')
    const id = state.items[0]!.id
    expect(state.items[0]!.status).toBe('queued')
    state = queueReducer(state, { type: 'start', id })
    expect(state.items[0]!.status).toBe('uploading')
    state = queueReducer(state, { type: 'progress', id, fraction: 0.4 })
    expect(state.items[0]).toMatchObject({ status: 'uploading', progress: 0.4 })
    state = queueReducer(state, { type: 'progress', id, fraction: 1 })
    expect(state.items[0]!.status).toBe('parsing')
    state = queueReducer(state, { type: 'done', id, log })
    expect(state.items[0]).toMatchObject({ status: 'done', log })
  })

  it('ignores impossible transitions', () => {
    let state = add(initialQueue, 'a.txt')
    const id = state.items[0]!.id
    expect(queueReducer(state, { type: 'done', id, log })).toBe(state)
    expect(queueReducer(state, { type: 'progress', id, fraction: 0.5 })).toBe(state)
    state = queueReducer(queueReducer(state, { type: 'start', id }), { type: 'done', id, log })
    expect(queueReducer(state, { type: 'start', id })).toBe(state)
    expect(queueReducer(state, { type: 'fail', id, status: 'no_overlap', message: 'x' })).toBe(state)
  })

  it.each(['no_overlap', 'not_a_gamelog', 'unknown_character', 'too_large'] as const)('ends in %s', (status) => {
    let state = add(initialQueue, 'a.txt')
    const id = state.items[0]!.id
    state = queueReducer(queueReducer(state, { type: 'start', id }), { type: 'fail', id, status, message: 'why' })
    expect(state.items[0]).toMatchObject({ status, message: 'why' })
  })

  it('marks duplicates with the file they match, and only removable ones can be removed', () => {
    let state = add(initialQueue, 'a.txt', 'b.txt')
    const [a, b] = state.items.map((item) => item.id) as [number, number]
    state = queueReducer(state, { type: 'start', id: a })
    state = queueReducer(state, { type: 'duplicate', id: a, of: 'first.txt' })
    expect(state.items[0]).toMatchObject({ status: 'duplicate', duplicateOf: 'first.txt' })
    expect(queueReducer(state, { type: 'remove', id: a }).items.map((i) => i.name)).toEqual(['b.txt'])
    const busy = queueReducer(state, { type: 'start', id: b })
    expect(queueReducer(busy, { type: 'remove', id: b })).toBe(busy)
  })

  it('counts items for the tray header', () => {
    let state = add(initialQueue, 'a', 'b', 'c', 'd')
    const [a, b, c] = state.items.map((item) => item.id) as [number, number, number]
    state = queueReducer(state, { type: 'start', id: a })
    state = queueReducer(state, { type: 'done', id: a, log })
    state = queueReducer(state, { type: 'start', id: b })
    state = queueReducer(state, { type: 'start', id: c })
    state = queueReducer(state, { type: 'fail', id: c, status: 'not_a_gamelog', message: '' })
    expect(summarizeQueue(state)).toEqual({ total: 4, done: 1, active: 2, attention: 1 })
  })
})

describe('runUpload', () => {
  const setup = (overrides: Partial<Parameters<typeof runUpload>[0]> = {}) => {
    const actions: unknown[] = []
    const deps = {
      id: 7,
      name: 'a.txt',
      size: 100,
      readText: async () => 'text',
      sha256: async () => 'hash',
      knownLogs: () => new Map<string, string>(),
      uploadLog: vi.fn(async (_text: string, onProgress?: (fraction: number) => void) => {
        onProgress?.(0.5)
        onProgress?.(1)
        return log
      }),
      dispatch: (action: unknown) => actions.push(action),
      ...overrides,
    } as Parameters<typeof runUpload>[0]
    return { deps, actions }
  }

  it('reports progress then done', async () => {
    const { deps, actions } = setup()
    await runUpload(deps)
    expect(actions).toEqual([
      { type: 'start', id: 7 },
      { type: 'progress', id: 7, fraction: 0.5 },
      { type: 'progress', id: 7, fraction: 1 },
      { type: 'done', id: 7, log },
    ])
  })

  it('skips the upload when the hash is already in the battle', async () => {
    const { deps, actions } = setup({ knownLogs: () => new Map([['hash', 'old.txt']]) })
    await runUpload(deps)
    expect(deps.uploadLog).not.toHaveBeenCalled()
    expect(actions.at(-1)).toEqual({ type: 'duplicate', id: 7, of: 'old.txt' })
  })

  it('treats a returned log that was already known as a duplicate (no hashing available)', async () => {
    const { deps, actions } = setup({ sha256: async () => null, knownLogs: () => new Map([['abc', 'Pilot']]) })
    await runUpload(deps)
    expect(actions.at(-1)).toEqual({ type: 'duplicate', id: 7, of: 'Pilot' })
  })

  it('rejects oversize files without reading them', async () => {
    const readText = vi.fn(async () => '')
    const { deps, actions } = setup({ size: 10 * 1024 * 1024 + 1, readText })
    await runUpload(deps)
    expect(readText).not.toHaveBeenCalled()
    expect(actions.at(-1)).toMatchObject({ type: 'fail', status: 'too_large', message: '文件 10.0 MB，超过上限 10 MB' })
  })

  const gamelog = [
    'Gamelog', '------------------------------------------------------------',
    '  Listener: Some Pilot', '  Session Started: 2026.11.21 07:56:05', '------------------------------------------------------------',
    '[ 2026.11.21 07:56:10 ] (combat) 12 from Foe - Gun - Hits',
    '[ 2026.11.21 08:30:00 ] (combat) 9 to Foe - Gun - Hits',
  ].join('\n')
  const windows = [{ start: Date.UTC(2025, 5, 22, 15, 0), end: Date.UTC(2025, 5, 22, 18, 0) }]
  const rejected = (code: ApiFailure['code'], extra: Partial<Parameters<typeof runUpload>[0]> = {}) =>
    setup({ readText: async () => gamelog, windows: () => windows, uploadLog: async () => { throw new ApiFailure(code, 'No log events fall within the battle windows', 400) }, ...extra })

  it('explains no_overlap in Chinese with the log date and the battle window', async () => {
    const { deps, actions } = rejected('no_overlap')
    await runUpload(deps)
    expect(actions.at(-1)).toEqual({ type: 'fail', id: 7, status: 'no_overlap',
      message: '这份日志是 2026-11-21 07:56:10–08:30:00 的，这场战斗在 2025-06-22 15:00–18:00' })
  })

  it('names both dates when the battle crosses midnight', async () => {
    const { deps, actions } = rejected('no_overlap', { windows: () => [{ start: Date.UTC(2025, 5, 22, 23, 30), end: Date.UTC(2025, 5, 23, 1, 0) }] })
    await runUpload(deps)
    expect(actions.at(-1)).toMatchObject({ message: expect.stringContaining('这场战斗在 2025-06-22 23:30–2025-06-23 01:00') })
  })

  it('falls back to the session date when the log has no events', async () => {
    const { deps, actions } = rejected('no_overlap', { readText: async () => gamelog.split('\n').slice(0, 5).join('\n') })
    await runUpload(deps)
    expect(actions.at(-1)).toMatchObject({ message: '这份日志是 2026-11-21 的，这场战斗在 2025-06-22 15:00–18:00' })
  })

  it('explains not_a_gamelog', async () => {
    const { deps, actions } = rejected('not_a_gamelog', { readText: async () => 'hello' })
    await runUpload(deps)
    expect(actions.at(-1)).toEqual({ type: 'fail', id: 7, status: 'not_a_gamelog', message: '这不是 EVE 战斗日志（找不到 Gamelog 文件头）' })
  })

  it('explains unknown_character with the listener', async () => {
    const { deps, actions } = rejected('unknown_character')
    await runUpload(deps)
    expect(actions.at(-1)).toEqual({ type: 'fail', id: 7, status: 'unknown_character', message: '查不到日志主人 Some Pilot 的角色' })
  })

  it('explains a server too_large with size and limit', async () => {
    const { deps, actions } = rejected('too_large', { size: 12 * 1024 * 1024 })
    await runUpload(deps)
    expect(actions.at(-1)).toEqual({ type: 'fail', id: 7, status: 'too_large', message: '文件 12.0 MB，超过上限 10 MB' })
  })

  it('shows a generic failure in Chinese and keeps the code for the tooltip', async () => {
    const { deps, actions } = rejected('bad_request', { uploadLog: async () => { throw new ApiFailure('bad_request', 'Internal Server Error', 500) } })
    await runUpload(deps)
    expect(actions.at(-1)).toEqual({ type: 'fail', id: 7, status: 'failed', message: '上传失败，请重试', detail: 'bad_request' })
  })

  it('maps an unreadable file to failed', async () => {
    const { deps, actions } = setup({ readText: async () => { throw new Error('boom') } })
    await runUpload(deps)
    expect(actions.at(-1)).toMatchObject({ type: 'fail', id: 7, status: 'failed' })
  })

  it('clearSettled drops finished, duplicate and failed rows and keeps queued or active ones', () => {
    let state: QueueState = queueReducer(initialQueue, { type: 'add', files: [{ name: 'a', size: 1 }, { name: 'b', size: 1 }, { name: 'c', size: 1 }, { name: 'd', size: 1 }] })
    state = queueReducer(state, { type: 'start', id: 1 })
    state = queueReducer(state, { type: 'done', id: 1, log: { id: 'x', charId: 1, charName: 'A', side: 0, events: 1, uploadedAt: 0 } })
    state = queueReducer(state, { type: 'start', id: 2 })
    state = queueReducer(state, { type: 'fail', id: 2, status: 'failed', message: 'no' })
    state = queueReducer(state, { type: 'start', id: 3 })
    state = queueReducer(state, { type: 'clearSettled' })
    expect(state.items.map(({ name, status }) => [name, status])).toEqual([['c', 'uploading'], ['d', 'queued']])
  })
})
