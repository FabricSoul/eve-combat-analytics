import { describe, expect, it } from 'vitest'
import { collectFiles } from './files'

const fileEntry = (name: string, result: File | Error) => ({
  isFile: true, isDirectory: false, name,
  file: (done: (f: File) => void, fail: (e: unknown) => void) => result instanceof Error ? fail(result) : done(result),
})
const dir = (name: string, children: unknown[]) => ({
  isFile: false, isDirectory: true, name,
  createReader: () => { let sent = false; return { readEntries: (done: (e: unknown[]) => void) => { done(sent ? [] : children); sent = true } } },
})
const txt = (name: string) => new File(['x'], name)

describe('collectFiles', () => {
  it('keeps successful entries and reports unreadable ones', async () => {
    const items = [{ kind: 'file', webkitGetAsEntry: () => dir('logs', [fileEntry('a.txt', txt('a.txt')), fileEntry('bad.txt', new Error('no')), fileEntry('b.txt', txt('b.txt')), fileEntry('skip.png', txt('skip.png'))]) }]
    const { files, problems } = await collectFiles({ files: [] as unknown as FileList, items: items as unknown as DataTransferItemList })
    expect(files.map(({ name }) => name)).toEqual(['a.txt', 'b.txt'])
    expect(problems.map(({ name }) => name)).toEqual(['bad.txt'])
  })

  it('reads dataTransfer.files before the first await (the drag store is protected afterwards)', async () => {
    let open = true
    const flat = [txt('flat.txt')]
    const transfer = {
      get files() { if (!open) throw new Error('protected'); return flat as unknown as FileList },
      items: [{ kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => (open ? flat[0] : null) }] as unknown as DataTransferItemList,
    }
    const pending = collectFiles(transfer)
    open = false
    const { files } = await pending
    expect(files.map(({ name }) => name)).toEqual(['flat.txt'])
  })

  it('keeps plain file items next to a directory', async () => {
    const loose = txt('loose.txt')
    const items = [
      { kind: 'file', webkitGetAsEntry: () => dir('d', [fileEntry('in.txt', txt('in.txt'))]) },
      { kind: 'file', webkitGetAsEntry: () => null, getAsFile: () => loose },
    ]
    const { files } = await collectFiles({ files: [loose] as unknown as FileList, items: items as unknown as DataTransferItemList })
    expect(files.map(({ name }) => name).sort()).toEqual(['in.txt', 'loose.txt'])
  })
})
