// @vitest-environment jsdom
import { act, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { UploadedLogSummary } from '@/core/contract'
import { api, ApiFailure } from '../api/client'
import { fmtDate, fmtHms } from '../lib/format'
import { BattleProvider } from '../state/battle-store'
import { ViewProvider } from '../state/view-store'
import { loadUiFixture } from '../test/ui-fixture'
import { UploadDock } from './UploadDock'

let root: Root | undefined
let host: HTMLElement
beforeAll(() => { (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true })
beforeEach(() => { vi.restoreAllMocks() })
afterEach(() => { act(() => root?.unmount()); host?.remove() })

const picker = createRef<HTMLInputElement>()

function mount() {
  const fixture = loadUiFixture()
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => root!.render(
    <BattleProvider static={fixture}>
      <ViewProvider syncUrl={false}><UploadDock pickerRef={picker} /></ViewProvider>
    </BattleProvider>,
  ))
  return fixture
}

const file = (name: string, text = 'Gamelog') => new File([text], name, { type: 'text/plain' })

function dragEvent(type: string, files: File[]) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'], items: [] } })
  return event
}

const settle = () => act(async () => { await new Promise((resolve) => setTimeout(resolve, 20)) })

const newLog = (over: Partial<UploadedLogSummary> = {}): UploadedLogSummary =>
  ({ id: 'n1', charId: 2117427381, charName: 'Lucinda HIly', side: 0, events: 7425, uploadedAt: 0, first: 1750606783000, last: 1750609081000, language: 'zh', ...over })

describe('UploadDock', () => {
  it('shows nothing but a hidden multi-file input until files arrive', () => {
    mount()
    expect(host.querySelector('.upload-tray')).toBeNull()
    expect(picker.current?.multiple).toBe(true)
  })

  it('shows the whole-page overlay while files are dragged over the page, and hides it on leave', () => {
    mount()
    act(() => { window.dispatchEvent(dragEvent('dragenter', [])) })
    expect(document.querySelector('.upload-overlay')).not.toBeNull()
    act(() => { window.dispatchEvent(dragEvent('dragleave', [])) })
    expect(document.querySelector('.upload-overlay')).toBeNull()
  })

  it('uploads dropped files one after another and reports the finished one', async () => {
    mount()
    let release: (() => void) | undefined
    const calls: string[] = []
    vi.spyOn(api, 'uploadLog').mockImplementation(async (_br, text, onProgress) => {
      calls.push(text)
      onProgress?.(0.5)
      if (calls.length === 1) await new Promise<void>((resolve) => { release = resolve })
      onProgress?.(1)
      return newLog({ id: `n${calls.length}` })
    })
    await act(async () => { window.dispatchEvent(dragEvent('drop', [file('a.txt', 'one'), file('b.txt', 'two')])) })
    await settle()
    expect(calls).toEqual(['one'])
    expect(host.querySelectorAll('.upload-row')).toHaveLength(2)
    expect(host.querySelector('.upload-row[data-status="uploading"]')).not.toBeNull()
    expect(host.querySelector('.upload-row[data-status="queued"]')).not.toBeNull()
    await act(async () => { release!() })
    await settle()
    expect(calls).toEqual(['one', 'two'])
    const done = host.querySelectorAll('.upload-row[data-status="done"]')
    expect(done).toHaveLength(2)
    expect(done[0]!.textContent).toContain('Lucinda HIly')
    expect(done[0]!.textContent).toContain('7,425')
    expect(done[0]!.textContent).toContain('中文客户端')
  })

  it.each([
    ['no_overlap', '时间对不上'],
    ['not_a_gamelog', '不是战斗日志'],
    ['unknown_character', '查不到角色'],
    ['too_large', '文件太大'],
  ] as const)('shows %s with a remove button', async (code, label) => {
    mount()
    vi.spyOn(api, 'uploadLog').mockRejectedValue(new ApiFailure(code, '服务器的说明', 400))
    await act(async () => { window.dispatchEvent(dragEvent('drop', [file('x.txt')])) })
    await settle()
    const row = host.querySelector(`.upload-row[data-status="${code}"]`)!
    expect(row.textContent).toContain(label)
    expect(row.textContent).not.toContain('服务器的说明')
    act(() => row.querySelector<HTMLButtonElement>('button')!.click())
    expect(host.querySelector('.upload-row')).toBeNull()
  })

  it('shows a generic failure in Chinese with the code in a tooltip', async () => {
    mount()
    vi.spyOn(api, 'uploadLog').mockRejectedValue(new ApiFailure('bad_request', 'Internal Server Error', 500))
    await act(async () => { window.dispatchEvent(dragEvent('drop', [file('x.txt')])) })
    await settle()
    const row = host.querySelector('.upload-row[data-status="failed"]')!
    expect(row.textContent).toContain('上传失败，请重试')
    expect(row.textContent).not.toContain('Internal')
    expect(row.querySelector('[title="bad_request"]')).not.toBeNull()
  })

  it('tells a log from another fight when it is, with the battle window (no_overlap)', async () => {
    const fixture = mount()
    vi.spyOn(api, 'uploadLog').mockRejectedValue(new ApiFailure('no_overlap', 'No log events fall within the battle windows', 400))
    const text = ['Gamelog', '------', '  Listener: P', '  Session Started: 2026.11.21 07:56:05', '------', '[ 2026.11.21 07:56:10 ] (combat) 1 from X - G - Hits'].join('\n')
    await act(async () => { window.dispatchEvent(dragEvent('drop', [file('other.txt', text)])) })
    await settle()
    const row = host.querySelector('.upload-row[data-status="no_overlap"]')!
    expect(row.textContent).toContain('这份日志是 2026-11-21')
    expect(row.textContent).toContain(`这场战斗在 ${fmtDate(fixture.summary.meta.windows[0]!.start)}`)
    expect(row.textContent).not.toContain('No log events')
  })

  it('skips a file that is already in the battle and says which one it matches', async () => {
    const fixture = mount()
    const known = fixture.summary.logs[0]!
    const upload = vi.spyOn(api, 'uploadLog').mockResolvedValue(known)
    await act(async () => { window.dispatchEvent(dragEvent('drop', [file('again.txt')])) })
    await settle()
    const row = host.querySelector('.upload-row[data-status="duplicate"]')!
    expect(upload).toHaveBeenCalledOnce()
    expect(row.textContent).toContain('完全相同')
    expect(row.textContent).toContain(known.charName)
    expect(row.textContent).toContain(`${known.charName} 的日志（${fmtHms(known.first!)}–${fmtHms(known.last!)}）`)
  })

  it('names a file seen on this page by its file name (C-fix 3)', async () => {
    mount()
    vi.spyOn(api, 'uploadLog').mockResolvedValue(newLog({ id: 'a'.repeat(64), charName: 'Fresh' }))
    await act(async () => { window.dispatchEvent(dragEvent('drop', [file('first.txt', 'same text')])) })
    await settle()
    await act(async () => { window.dispatchEvent(dragEvent('drop', [file('second.txt', 'same text')])) })
    await settle()
    const row = host.querySelector('.upload-row[data-status="duplicate"]')!
    expect(row.textContent).toContain('和已上传的 first.txt 完全相同，跳过')
  })

  it('reports a duplicate the server caught that this page has not seen yet (a teammate uploaded it at the same moment)', async () => {
    mount()
    const teammates = newLog({ id: 'f'.repeat(64), charName: 'Teammate Pilot' })
    vi.spyOn(api, 'uploadLog').mockResolvedValue({ ...teammates, duplicate: true })
    await act(async () => { window.dispatchEvent(dragEvent('drop', [file('same-moment.txt', 'teammate copy')])) })
    await settle()
    const row = host.querySelector('.upload-row[data-status="duplicate"]')
    expect(row).not.toBeNull()
    expect(row!.textContent).toContain('完全相同')
    expect(row!.textContent).toContain('Teammate Pilot')
    expect(host.querySelector('.upload-row[data-status="done"]')).toBeNull()
  })

  it('closes the upload list with its × button and reopens it for the next drop', async () => {
    mount()
    let n = 0
    vi.spyOn(api, 'uploadLog').mockImplementation(async () => newLog({ id: `closed${++n}` }))
    await act(async () => { window.dispatchEvent(dragEvent('drop', [file('first.txt', 'first')])) })
    await settle()
    expect(host.querySelector('.upload-row[data-status="done"]')).not.toBeNull()
    const close = host.querySelector<HTMLButtonElement>('.upload-tray button[aria-label="关闭上传列表"]')
    expect(close).not.toBeNull()
    act(() => close!.click())
    expect(host.querySelector('.upload-tray')).toBeNull()
    await act(async () => { window.dispatchEvent(dragEvent('drop', [file('second.txt', 'second')])) })
    await settle()
    const rows = [...host.querySelectorAll('.upload-row .upload-file')].map((cell) => cell.textContent)
    expect(rows).toEqual(['second.txt'])
  })

  it('keeps two batches dropped in the same turn apart (R2a-1)', async () => {
    mount()
    const bodies: string[] = []
    vi.spyOn(api, 'uploadLog').mockImplementation(async (_br, text) => {
      bodies.push(text)
      return newLog({ id: `id-${text}`, charName: `pilot-${text}` })
    })
    await act(async () => {
      window.dispatchEvent(dragEvent('drop', [file('alpha.txt', 'alpha')]))
      window.dispatchEvent(dragEvent('drop', [file('beta.txt', 'beta')]))
    })
    await settle()
    await settle()
    expect(bodies).toEqual(['alpha', 'beta'])
    const rows = Array.from(host.querySelectorAll('.upload-row'))
    expect(rows).toHaveLength(2)
    expect(rows[0]!.textContent).toContain('alpha.txt')
    expect(rows[0]!.textContent).toContain('pilot-alpha')
    expect(rows[1]!.textContent).toContain('beta.txt')
    expect(rows[1]!.textContent).toContain('pilot-beta')
    expect(host.querySelectorAll('.upload-row[data-status="done"]')).toHaveLength(2)
  })

  it('reports unreadable folder entries and still uploads the readable ones (R2a-10)', async () => {
    mount()
    const bodies: string[] = []
    vi.spyOn(api, 'uploadLog').mockImplementation(async (_br, text) => { bodies.push(text); return newLog({ id: text }) })
    const good = file('good.txt', 'good')
    const entry = (over: object) => ({ isFile: false, isDirectory: false, name: 'x', ...over })
    const folder = entry({
      isDirectory: true, name: 'Gamelogs',
      createReader: () => {
        let sent = false
        return { readEntries: (done: (e: unknown[]) => void) => { done(sent ? [] : [
          entry({ isFile: true, name: 'good.txt', file: (ok: (f: File) => void) => ok(good) }),
          entry({ isFile: true, name: 'locked.txt', file: (_ok: unknown, fail: (e: unknown) => void) => fail(new Error('denied')) }),
        ]); sent = true } }
      },
    })
    const event = new Event('drop', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { files: [], types: ['Files'], items: [{ kind: 'file', webkitGetAsEntry: () => folder }] } })
    await act(async () => { window.dispatchEvent(event) })
    await settle()
    expect(bodies).toEqual(['good'])
    const failed = host.querySelector('.upload-row[data-status="failed"]')!
    expect(failed.textContent).toContain('locked.txt')
  })

  it('opens from the picker input too', async () => {
    mount()
    vi.spyOn(api, 'uploadLog').mockResolvedValue(newLog())
    const input = picker.current!
    Object.defineProperty(input, 'files', { value: [file('p.txt')], configurable: true })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await settle()
    expect(host.querySelector('.upload-row[data-status="done"]')).not.toBeNull()
  })
})
