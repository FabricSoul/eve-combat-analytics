import type {
  BattleMeta, BattleState, BattleSummary, FitEntry, LogEvent, NameIndex, ParsedLog, SideOverride,
  SideSubject, UploadedLog, UploadedLogSummary,
} from '../core/contract'

export type StoredAffiliation = Pick<UploadedLog, 'corpId' | 'allyId'>
type LogSummary = UploadedLogSummary & StoredAffiliation
type LogEventSummary = Pick<UploadedLogSummary, 'first' | 'last' | 'language'>
type LogRow = Omit<UploadedLogSummary, keyof LogEventSummary> & {
  eventSummary: string | null
  unparsedCount: number | null
  affiliation: string | null
}
export type StoredLog = UploadedLog & { unparsedCount: number }
export type PendingLog = { id: string; nameOffset: number; events: LogEvent[] }
export type PackedJson = ArrayBuffer[]

const CHUNK_BYTES = 1024 * 1024
const SIDE_EDIT_LIMIT = 30
const SIDE_EDIT_WINDOW_MS = 60_000

function unpackAffiliation(value: string | null): StoredAffiliation {
  return value === null ? {} : JSON.parse(value)
}

function packAffiliation({ corpId, allyId }: StoredAffiliation): string {
  return JSON.stringify({ corpId, allyId })
}

export async function packJson(value: unknown): Promise<PackedJson> {
  return packStream(new Blob([JSON.stringify(value)]).stream())
}

export async function packStream(json: ReadableStream<BufferSource>): Promise<PackedJson> {
  const stream = json.pipeThrough(new CompressionStream('gzip'))
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

  private hasColumn(table: 'logs' | 'names', column: string): boolean {
    return this.sql.exec<{ name: string }>(`PRAGMA table_info(${table})`).toArray()
      .some(({ name }) => name === column)
  }

  private logRows(id?: string): LogRow[] {
    const columns = 'id, charId, charName, side, uploadedAt, events'
    const count = this.legacy ? 'NULL AS unparsedCount' : 'unparsedCount'
    const affiliation = this.hasColumn('logs', 'affiliation') ? 'affiliation' : 'NULL AS affiliation'
    const eventSummary = this.hasColumn('logs', 'eventSummary') ? 'eventSummary' : 'NULL AS eventSummary'
    const where = id === undefined ? '' : 'WHERE id = ?'
    return this.sql.exec<LogRow>(
      `SELECT ${columns}, ${count}, ${affiliation}, ${eventSummary} FROM logs ${where} ORDER BY charId, uploadedAt, id`, ...(id === undefined ? [] : [id]),
    ).toArray()
  }

  private summarizeLog({ id, charId, charName, side, events, uploadedAt, affiliation, eventSummary }: LogRow): LogSummary {
    const details: LogEventSummary = eventSummary === null ? {} : JSON.parse(eventSummary)
    return { id, charId, charName, side, events, uploadedAt, ...unpackAffiliation(affiliation), ...details }
  }

  logById(id: string): LogSummary | undefined {
    const row = this.logRows(id)[0]
    return row && this.summarizeLog(row)
  }

  async logDetail(id: string): Promise<StoredLog | undefined> {
    const row = this.logRows(id)[0]
    return row && this.getLog(row)
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

  private async getLog({ id, charId, charName, side, uploadedAt, unparsedCount, affiliation }: LogRow): Promise<StoredLog> {
    const parsed = await this.parsed({ id, charId })
    return {
      id, charId, charName, side, uploadedAt, ...unpackAffiliation(affiliation),
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

  private fitsAndNames(): Pick<BattleState, 'fits' | 'names'> {
    const fits = this.sql.exec<FitEntry & Record<string, SqlStorageValue>>('SELECT * FROM fits ORDER BY charId').toArray()
    const affiliation = this.hasColumn('names', 'affiliation') ? 'affiliation' : 'NULL AS affiliation'
    const rows = this.sql.exec<{ name: string; charId: number | null; side: number | null; affiliation: string | null }>(
      `SELECT name, charId, side, ${affiliation} FROM names`,
    ).toArray()
    const names: NameIndex = Object.fromEntries(rows.map(({ name, charId, side, affiliation }) => [
      name, charId === null ? null : { charId, side: side ?? -1, ...unpackAffiliation(affiliation) },
    ]))
    return { fits, names }
  }

  summary(meta: BattleMeta): BattleSummary {
    const logs = this.logRows().map((row) => this.summarizeLog(row))
    return { meta, logs, ...this.fitsAndNames(), sideOverrides: this.sideOverrides(), analysisVersion: this.analysisStatus().version }
  }

  async state(meta: BattleMeta): Promise<BattleState> {
    const rows = this.logRows()
    const { fits, names } = this.fitsAndNames()
    const sideOverrides = this.sideOverrides()
    const logs: StoredLog[] = []
    // Read one JSON value at a time to cap transient decompression and parsing memory.
    for (const row of rows) logs.push(await this.getLog(row))
    return { meta, logs, fits, names, sideOverrides }
  }

  private sideOverrides(): SideOverride[] {
    if (!this.hasTable('side_overrides')) return []
    return this.sql.exec<{ subject: SideSubject; side: number; setAt: number }>(
      'SELECT subject, side, setAt FROM side_overrides ORDER BY id',
    ).toArray().map((entry) => ({ ...entry, source: 'manual' }))
  }

  canEditSide(setAt: number): boolean {
    if (!this.hasTable('side_edits')) return true
    const { count } = this.sql.exec<{ count: number }>(
      'SELECT count(*) AS count FROM side_edits WHERE setAt > ?', setAt - SIDE_EDIT_WINDOW_MS,
    ).one()
    return count < SIDE_EDIT_LIMIT
  }

  setSide({ subject, side, setAt }: SideOverride): SideOverride[] {
    return this.storage.transactionSync(() => {
      if (!this.hasTable('side_edits')) {
        this.sql.exec(`
          CREATE TABLE side_edits (id INTEGER PRIMARY KEY, setAt INTEGER NOT NULL);
          CREATE TABLE side_overrides (
            id INTEGER PRIMARY KEY, subject TEXT UNIQUE NOT NULL, side INTEGER NOT NULL, setAt INTEGER NOT NULL
          );
        `)
      }
      this.sql.exec('DELETE FROM side_edits WHERE setAt <= ?', setAt - SIDE_EDIT_WINDOW_MS)
      this.sql.exec('INSERT INTO side_edits (setAt) VALUES (?)', setAt)
      if (side === -1) {
        this.sql.exec('DELETE FROM side_overrides WHERE subject = ?', subject)
      } else {
        this.sql.exec('INSERT OR REPLACE INTO side_overrides (subject, side, setAt) VALUES (?, ?, ?)', subject, side, setAt)
      }
      this.markAnalysisDirty()
      return this.sideOverrides()
    })
  }

  analysisStatus(): { revision: number; analyzedRevision: number; version: number } {
    if (!this.hasTable('analysis_state')) return { revision: 0, analyzedRevision: -1, version: 0 }
    return this.sql.exec<{ revision: number; analyzedRevision: number; version: number }>(
      'SELECT revision, analyzedRevision, version FROM analysis_state WHERE id = 1',
    ).one()
  }

  private setupAnalysis(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS analysis_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL, analyzedRevision INTEGER NOT NULL, version INTEGER NOT NULL
      );
      INSERT OR IGNORE INTO analysis_state VALUES (1, 0, -1, 0);
      CREATE TABLE IF NOT EXISTS analysis_chunks (seq INTEGER PRIMARY KEY, data BLOB NOT NULL);
    `)
  }

  private markAnalysisDirty(): void {
    if (!this.hasTable('analysis_state')) this.setupAnalysis()
    this.sql.exec('UPDATE analysis_state SET revision = revision + 1 WHERE id = 1')
  }

  analysisChunks(): PackedJson {
    return this.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM analysis_chunks ORDER BY seq')
      .toArray().map(({ data }) => data)
  }

  publishAnalysis(revision: number, chunks: PackedJson): number | undefined {
    return this.storage.transactionSync(() => {
      const status = this.analysisStatus()
      if (status.revision !== revision || status.analyzedRevision === revision) return undefined
      if (status.version === 0) this.setupAnalysis()
      const version = status.version + 1
      this.sql.exec('DELETE FROM analysis_chunks')
      chunks.forEach((data, seq) => this.sql.exec('INSERT INTO analysis_chunks VALUES (?, ?)', seq, data))
      this.sql.exec('UPDATE analysis_state SET version = ?, analyzedRevision = ? WHERE id = 1', version, revision)
      return version
    })
  }

  saveLog(
    log: StoredLog,
    packed: PackedJson,
    resolution: { names: NameIndex; currentOffset: number | null; pending?: { id: string; offset: number | null } },
  ): LogSummary {
    const { charId, id, charName, side, uploadedAt, unparsedCount, parsed, corpId, allyId } = log
    const details: LogEventSummary = { first: parsed.events[0]?.t, last: parsed.events.at(-1)?.t, language: parsed.language }
    this.storage.transactionSync(() => {
      if (!this.hasColumn('logs', 'affiliation')) this.sql.exec('ALTER TABLE logs ADD COLUMN affiliation TEXT')
      if (!this.hasColumn('names', 'affiliation')) this.sql.exec('ALTER TABLE names ADD COLUMN affiliation TEXT')
      if (!this.hasColumn('logs', 'eventSummary')) this.sql.exec('ALTER TABLE logs ADD COLUMN eventSummary TEXT')
      this.sql.exec(
        `INSERT INTO logs (id, charId, charName, side, uploadedAt, events, unparsedCount, nameOffset, affiliation, eventSummary)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        id, charId, charName, side, uploadedAt, parsed.events.length, unparsedCount, resolution.currentOffset,
        packAffiliation(log), JSON.stringify(details),
      )
      packed.forEach((chunk, seq) => this.sql.exec('INSERT INTO log_chunks VALUES (?, ?, ?)', id, seq, chunk))
      if (resolution.pending) {
        this.sql.exec('UPDATE logs SET nameOffset = ? WHERE id = ?', resolution.pending.offset, resolution.pending.id)
      }
      for (const [name, entry] of Object.entries(resolution.names)) {
        this.sql.exec(
          'INSERT INTO names (name, charId, side, affiliation) VALUES (?, ?, ?, ?)',
          name, entry?.charId ?? null, entry?.side ?? null, entry && packAffiliation(entry),
        )
      }
      this.markAnalysisDirty()
    })
    return { id, charId, charName, side, corpId, allyId, events: parsed.events.length, uploadedAt, ...details }
  }

  setFit({ charId, eft, setAt }: FitEntry): void {
    this.storage.transactionSync(() => {
      this.sql.exec(
        'INSERT INTO fits VALUES (?, ?, ?) ON CONFLICT(charId) DO UPDATE SET eft = excluded.eft, setAt = excluded.setAt',
        charId, eft, setAt,
      )
      this.markAnalysisDirty()
    })
  }
}
