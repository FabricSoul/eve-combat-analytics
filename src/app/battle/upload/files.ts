// Collects the files of a drop, walking dropped folders (browsers expose them as FileSystemEntry).
interface Entry {
  isFile: boolean
  isDirectory: boolean
  file?(done: (file: File) => void, fail: (error: unknown) => void): void
  createReader?(): { readEntries(done: (entries: Entry[]) => void, fail: (error: unknown) => void): void }
}

const isGamelogName = (name: string) => /\.txt$/i.test(name)

async function walk(entry: Entry, found: File[]): Promise<void> {
  if (entry.isFile && entry.file) {
    const file = await new Promise<File>((done, fail) => entry.file!(done, fail))
    if (isGamelogName(file.name)) found.push(file)
  } else if (entry.isDirectory && entry.createReader) {
    const reader = entry.createReader()
    for (;;) {
      const batch = await new Promise<Entry[]>((done, fail) => reader.readEntries(done, fail))
      if (batch.length === 0) break
      for (const child of batch) await walk(child, found)
    }
  }
}

/** Files directly dropped are kept as they are (the server says what is wrong with them); inside folders only `.txt` files count. */
export async function collectFiles(transfer: Pick<DataTransfer, 'files' | 'items'>): Promise<File[]> {
  const items = Array.from(transfer.items ?? [])
  const entries = items.flatMap((item) => {
    const entry = (item.webkitGetAsEntry?.() ?? null) as Entry | null
    return entry ? [entry] : []
  })
  if (entries.some(({ isDirectory }) => isDirectory)) {
    const found: File[] = []
    try {
      for (const entry of entries) {
        if (entry.isDirectory) await walk(entry, found)
        else if (entry.file) found.push(await new Promise<File>((done, fail) => entry.file!(done, fail)))
      }
      return found
    } catch {
      // Fall through to the flat file list.
    }
  }
  return Array.from(transfer.files)
}

export function hasFiles(transfer: DataTransfer | null): boolean {
  return !!transfer && Array.from(transfer.types ?? []).includes('Files')
}
