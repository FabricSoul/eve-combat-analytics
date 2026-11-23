// Collects the files of a drop, walking dropped folders (browsers expose them as FileSystemEntry).
interface Entry {
  isFile: boolean
  isDirectory: boolean
  name?: string
  file?(done: (file: File) => void, fail: (error: unknown) => void): void
  createReader?(): { readEntries(done: (entries: Entry[]) => void, fail: (error: unknown) => void): void }
}

export interface DropProblem { name: string; message: string }
export interface DropResult { files: File[]; problems: DropProblem[] }

const isGamelogName = (name: string) => /\.txt$/i.test(name)
const unreadable = (name: string): DropProblem => ({ name, message: '无法读取这个文件或文件夹' })
const readFile = (entry: Entry) => new Promise<File>((done, fail) => entry.file!(done, fail))

async function walk(entry: Entry, found: File[], problems: DropProblem[], direct: boolean): Promise<void> {
  const name = entry.name ?? '（未知）'
  try {
    if (entry.isFile && entry.file) {
      const file = await readFile(entry)
      // Directly dropped files go to the server, which says what is wrong; inside folders only .txt counts.
      if (direct || isGamelogName(file.name)) found.push(file)
    } else if (entry.isDirectory && entry.createReader) {
      const reader = entry.createReader()
      for (;;) {
        const batch = await new Promise<Entry[]>((done, fail) => reader.readEntries(done, fail))
        if (batch.length === 0) break
        for (const child of batch) await walk(child, found, problems, false)
      }
    } else {
      problems.push({ name, message: '不支持的拖放内容' })
    }
  } catch {
    problems.push(unreadable(name))
  }
}

/**
 * Everything that needs the drag data store (items, entries, getAsFile, files) is read before the first await:
 * the browser makes the store unreadable once the drop handler returns.
 */
export function collectFiles(transfer: Pick<DataTransfer, 'files' | 'items'>): Promise<DropResult> {
  const flat = Array.from(transfer.files ?? [])
  const found: File[] = []
  const problems: DropProblem[] = []
  const entries: Entry[] = []
  for (const item of Array.from(transfer.items ?? [])) {
    if (item.kind && item.kind !== 'file') continue
    const entry = (item.webkitGetAsEntry?.() ?? null) as Entry | null
    if (entry) entries.push(entry)
    else {
      const file = item.getAsFile?.()
      if (file) found.push(file)
    }
  }
  return (async () => {
    for (const entry of entries) await walk(entry, found, problems, true)
    return { files: found.length > 0 || problems.length > 0 || entries.length > 0 ? found : flat, problems }
  })()
}

export function hasFiles(transfer: DataTransfer | null): boolean {
  return !!transfer && Array.from(transfer.types ?? []).includes('Files')
}
