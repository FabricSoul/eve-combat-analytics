import type {
  BattleMeta, BattleState, FitEntry, LogEvent, NameIndex, ParsedLog, UploadedLog, UploadedLogSummary,
} from '../core/contract'

type LogRow = Pick<UploadedLogSummary, keyof UploadedLogSummary> & { unparsedCount: number | null }
export type StoredLog = UploadedLog & { unparsedCount: number }
export type PendingLog = { id: string; nameOffset: number; events: LogEvent[] }
export type PackedJson = ArrayBuffer[]

const CHUNK_BYTES = 1024 * 1024

export async function packJson(value: unknown): Promise<PackedJson> {
  const stream = new Blob([JSON.stringify(value)]).stream().pipeThrough(new CompressionStream('gzip'))
  const packed = await new Response(stream).arrayBuffer()
  const chunks: PackedJson = []
  for (let offset = 0; offset < packed.byteLength; offset += CHUNK_BYTES) {
    chunks.push(packed.slice(offset, offset + CHUNK_BYTES))
  }
  return chunks
}

async function unpackJson<T>(chunks: PackedJson): Promise<T> {
  const stream = new Blob(chunks).stream().pipeThrough(new DecompressionStream('gzip'))
  return new Response(stream).json()
}

export class BattleStorage {
  private readonly sql: SqlStorage

  constructor(private readonly storage: DurableObjectStorage) {
    this.sql = storage.sql
  }

  private hasTable(name: string): boolean {
    return !!this.sql.exec('SELECT 1 FROM sqlite_master WHERE type = ? AND name = ?', 'table', name).toArray()[0]
  }

  private get legacy(): boolean {
    return this.hasTable('meta')
  }

  exists(): boolean {
    if (this.legacy) return !!this.sql.exec('SELECT 1 FROM meta WHERE id = 1').toArray()[0]
    return this.hasTable('meta_chunks') && !!this.sql.exec('SELECT 1 FROM meta_chunks LIMIT 1').toArray()[0]
  }

  async meta(): Promise<BattleMeta> {
    if (this.legacy) {
      return JSON.parse(this.sql.exec<{ data: string }>('SELECT data FROM meta WHERE id = 1').one().data)
    }
    const chunks = this.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM meta_chunks ORDER BY seq').toArray()
    return unpackJson(chunks.map(({ data }) => data))
  }

  async migrateIfNeeded(meta: BattleMeta): Promise<void> {
    if (this.legacy) this.initialize(await packJson(meta))
  }

  initialize(meta: PackedJson): void {
    this.storage.transactionSync(() => {
      const legacy = this.legacy
      if (legacy) {
        this.sql.exec('ALTER TABLE logs RENAME TO legacy_logs; ALTER TABLE log_chunks RENAME TO legacy_log_chunks;')
      }
      this.sql.exec(`
        CREATE TABLE meta_chunks (seq INTEGER PRIMARY KEY, data BLOB NOT NULL);
        CREATE TABLE logs (
          id TEXT PRIMARY KEY, charId INTEGER NOT NULL, charName TEXT NOT NULL, side INTEGER NOT NULL,
          uploadedAt INTEGER NOT NULL, events INTEGER NOT NULL, unparsedCount INTEGER, nameOffset INTEGER
        );
        CREATE INDEX pending_log_names ON logs (uploadedAt, id) WHERE nameOffset IS NOT NULL;
        CREATE TABLE log_chunks (
          logId TEXT NOT NULL REFERENCES logs(id),
          seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (logId, seq)
        );
        CREATE TABLE IF NOT EXISTS fits (charId INTEGER PRIMARY KEY, eft TEXT NOT NULL, setAt INTEGER NOT NULL);
        CREATE TABLE IF NOT EXISTS names (name TEXT PRIMARY KEY, charId INTEGER, side INTEGER);
      `)
      if (legacy) {
        this.sql.exec(`
          INSERT INTO logs (id, charId, charName, side, uploadedAt, events)
            SELECT id, charId, charName, side, uploadedAt, events FROM legacy_logs;
          INSERT INTO log_chunks
            SELECT logs.id, chunks.seq, chunks.data FROM legacy_log_chunks AS chunks
            JOIN legacy_logs AS logs USING (charId);
          DROP TABLE legacy_log_chunks;
          DROP TABLE legacy_logs;
          DROP TABLE meta;
        `)
      }
      meta.forEach((chunk, seq) => this.sql.exec('INSERT INTO meta_chunks VALUES (?, ?)', seq, chunk))
    })
  }

  private logRows(id?: string): LogRow[] {
    const columns = 'id, charId, charName, side, uploadedAt, events'
    const count = this.legacy ? 'NULL AS unparsedCount' : 'unparsedCount'
    const where = id === undefined ? '' : 'WHERE id = ?'
    return this.sql.exec<LogRow>(
      `SELECT ${columns}, ${count} FROM logs ${where} ORDER BY charId, uploadedAt, id`, ...(id === undefined ? [] : [id]),
    ).toArray()
  }

  logById(id: string): UploadedLogSummary | undefined {
    const row = this.logRows(id)[0]
    if (!row) return undefined
    const { id: logId, charId, charName, side, events, uploadedAt } = row
    return { id: logId, charId, charName, side, events, uploadedAt }
  }

  private parsed(row: Pick<LogRow, 'id' | 'charId'>): Promise<ParsedLog> {
    const legacy = this.legacy
    const chunks = this.sql.exec<{ data: ArrayBuffer }>(
      legacy ? 'SELECT data FROM log_chunks WHERE charId = ? ORDER BY seq'
        : 'SELECT data FROM log_chunks WHERE logId = ? ORDER BY seq',
      legacy ? row.charId : row.id,
    ).toArray()
    return unpackJson(chunks.map(({ data }) => data))
  }

  async getLog({ id, charId, charName, side, uploadedAt, unparsedCount }: LogRow): Promise<StoredLog> {
    const parsed = await this.parsed({ id, charId })
    return {
      id, charId, charName, side, uploadedAt,
      parsed: { ...parsed, unparsed: parsed.unparsed.slice(0, 500) },
      unparsedCount: unparsedCount ?? parsed.unparsed.length,
    }
  }

  async pendingLog(): Promise<PendingLog | undefined> {
    const row = this.sql.exec<{ id: string; charId: number; nameOffset: number }>(
      'SELECT id, charId, nameOffset FROM logs WHERE nameOffset IS NOT NULL ORDER BY uploadedAt, id LIMIT 1',
    ).toArray()[0]
    if (!row) return undefined
    return { id: row.id, nameOffset: row.nameOffset, events: (await this.parsed(row)).events }
  }

  hasName(name: string): boolean {
    return !!this.sql.exec('SELECT 1 FROM names WHERE name = ?', name).toArray()[0]
  }

  async state(meta: BattleMeta): Promise<BattleState> {
    const rows = this.logRows()
    const fits = this.sql.exec<FitEntry & Record<string, SqlStorageValue>>('SELECT * FROM fits ORDER BY charId').toArray()
    const names: NameIndex = Object.fromEntries(
      this.sql.exec<{ name: string; charId: number | null; side: number | null }>(
        'SELECT * FROM names',
      ).toArray().map(({ name, charId, side }) => [name, charId === null ? null : { charId, side: side ?? -1 }]),
    )
    const logs = await Promise.all(rows.map((row) => this.getLog(row)))
    return { meta, logs, fits, names }
  }

  saveLog(
    log: StoredLog,
    packed: PackedJson,
    resolution: { names: NameIndex; currentOffset: number | null; pending?: { id: string; offset: number | null } },
  ): void {
    const { charId, id, charName, side, uploadedAt, unparsedCount, parsed } = log
    this.storage.transactionSync(() => {
      this.sql.exec(
        'INSERT INTO logs VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        id, charId, charName, side, uploadedAt, parsed.events.length, unparsedCount, resolution.currentOffset,
      )
      packed.forEach((chunk, seq) => this.sql.exec('INSERT INTO log_chunks VALUES (?, ?, ?)', id, seq, chunk))
      if (resolution.pending) {
        this.sql.exec('UPDATE logs SET nameOffset = ? WHERE id = ?', resolution.pending.offset, resolution.pending.id)
      }
      for (const [name, entry] of Object.entries(resolution.names)) {
        this.sql.exec('INSERT INTO names VALUES (?, ?, ?)', name, entry?.charId ?? null, entry?.side ?? null)
      }
    })
  }

  setFit({ charId, eft, setAt }: FitEntry): void {
    this.sql.exec(
      'INSERT INTO fits VALUES (?, ?, ?) ON CONFLICT(charId) DO UPDATE SET eft = excluded.eft, setAt = excluded.setAt',
      charId, eft, setAt,
    )
  }
}
