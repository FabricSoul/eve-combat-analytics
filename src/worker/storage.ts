import type { BattleMeta, BattleState, FitEntry, NameIndex, ParsedLog, UploadedLog } from '../core/contract'

interface LogRow {
  id: string
  charId: number
  charName: string
  side: number
  uploadedAt: number
  events: number
}

const CHUNK_BYTES = 1024 * 1024

export async function compressLog(parsed: ParsedLog): Promise<Uint8Array<ArrayBuffer>> {
  const stream = new Blob([JSON.stringify(parsed)]).stream().pipeThrough(new CompressionStream('gzip'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function decompressLog(chunks: ArrayBuffer[]): Promise<ParsedLog> {
  const stream = new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).json()
}

export class BattleStorage {
  private readonly sql: SqlStorage

  constructor(private readonly storage: DurableObjectStorage) {
    this.sql = storage.sql
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS meta (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS logs (
        charId INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, charName TEXT NOT NULL,
        side INTEGER NOT NULL, uploadedAt INTEGER NOT NULL, events INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS log_chunks (
        charId INTEGER NOT NULL REFERENCES logs(charId) ON DELETE CASCADE,
        seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (charId, seq)
      );
      CREATE TABLE IF NOT EXISTS fits (charId INTEGER PRIMARY KEY, eft TEXT NOT NULL, setAt INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS names (name TEXT PRIMARY KEY, charId INTEGER, side INTEGER);
    `)
  }

  meta(): BattleMeta | undefined {
    const row = this.sql.exec<{ data: string }>('SELECT data FROM meta WHERE id = 1').toArray()[0]
    return row && JSON.parse(row.data)
  }

  setMeta(meta: BattleMeta): void {
    this.sql.exec('INSERT INTO meta (id, data) VALUES (1, ?)', JSON.stringify(meta))
  }

  logById(id: string): LogRow | undefined {
    return this.sql.exec<LogRow & Record<string, SqlStorageValue>>('SELECT * FROM logs WHERE id = ?', id).toArray()[0]
  }

  hasName(name: string): boolean {
    return this.sql.exec('SELECT 1 FROM names WHERE name = ?', name).toArray().length > 0
  }

  async state(meta: BattleMeta): Promise<BattleState> {
    const rows = this.sql.exec<LogRow & Record<string, SqlStorageValue>>('SELECT * FROM logs ORDER BY charId').toArray()
    const fits = this.sql.exec<FitEntry & Record<string, SqlStorageValue>>('SELECT * FROM fits ORDER BY charId').toArray()
    const names: NameIndex = Object.fromEntries(
      this.sql.exec<{ name: string; charId: number | null; side: number | null }>(
        'SELECT * FROM names',
      ).toArray().map(({ name, charId, side }) => [name, charId === null ? null : { charId, side: side ?? -1 }]),
    )
    // Capture all rows before awaiting decompression so every response reflects one SQLite snapshot.
    const logs = await Promise.all(rows.map(async ({ charId, id, charName, side, uploadedAt }) => {
      const chunks = this.sql.exec<{ data: ArrayBuffer }>(
        'SELECT data FROM log_chunks WHERE charId = ? ORDER BY seq', charId,
      ).toArray().map(({ data }) => data)
      return { id, charId, charName, side, uploadedAt, parsed: await decompressLog(chunks) }
    }))
    return { meta, logs, fits, names }
  }

  saveLog(log: UploadedLog, compressed: Uint8Array<ArrayBuffer>, names: NameIndex): boolean {
    const { charId, id, charName, side, uploadedAt, parsed } = log
    return this.storage.transactionSync(() => {
      const replaced = this.sql.exec('DELETE FROM logs WHERE charId = ?', charId).rowsWritten > 0
      this.sql.exec('INSERT INTO logs VALUES (?, ?, ?, ?, ?, ?)', charId, id, charName, side, uploadedAt, parsed.events.length)
      for (let offset = 0; offset < compressed.length; offset += CHUNK_BYTES) {
        const chunk = compressed.slice(offset, offset + CHUNK_BYTES).buffer
        this.sql.exec('INSERT INTO log_chunks VALUES (?, ?, ?)', charId, offset / CHUNK_BYTES, chunk)
      }
      for (const [name, entry] of Object.entries(names)) {
        this.sql.exec('INSERT INTO names VALUES (?, ?, ?)', name, entry?.charId ?? null, entry?.side ?? null)
      }
      return replaced
    })
  }

  setFit({ charId, eft, setAt }: FitEntry): void {
    this.sql.exec(
      'INSERT INTO fits VALUES (?, ?, ?) ON CONFLICT(charId) DO UPDATE SET eft = excluded.eft, setAt = excluded.setAt',
      charId, eft, setAt,
    )
  }
}
