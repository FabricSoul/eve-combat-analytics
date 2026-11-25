import { ANALYZER_VERSION } from '../core/analysis/version'
import type { HistoryKind } from '../core/esi/history'
import type {
  BattleMeta, BattleState, BattleSummary, EntityKey, FitEntry, IdentityMerge, LogEvent, NameIndex, ParsedLog, SideOverride,
  SideSubject, UploadedLog, UploadedLogSummary,
} from '../core/contract'

export type StoredAffiliation = Pick<UploadedLog, 'corpId' | 'allyId'>
export type SideAssignment = { side: number } & StoredAffiliation
type LogSummary = UploadedLogSummary & StoredAffiliation
type LogEventSummary = Pick<UploadedLogSummary, 'first' | 'last' | 'language'>
type LogRow = Omit<UploadedLogSummary, keyof LogEventSummary> & {
  eventSummary: string | null
  unparsedCount: number | null
  affiliation: string | null
}
type FitRow = Omit<FitEntry, 'mutated'> & { mutated: string | null; etag: string | null }
type VersionedFit = FitEntry & { etag?: string }

function readFitRow({ mutated, etag, ...fit }: FitRow): VersionedFit {
  const names: string[] | undefined = mutated === null ? undefined : JSON.parse(mutated)
  return { ...fit, ...(names?.length ? { mutated: names } : {}), ...(etag ? { etag } : {}) }
}
export type StoredLog = UploadedLog & { unparsedCount: number }
export type PendingLog = { id: string; nameOffset: number; events: LogEvent[] }
export type PackedJson = ArrayBuffer[]
export interface MetaNameResolution {
  names: BattleMeta['names']
  pendingIds: number[]
}
export type AffiliationRefresh = { assignments: Map<number, SideAssignment>; metaNames: MetaNameResolution }

export function affiliationNameIds({ charId, corpId, allyId }: { charId: number } & StoredAffiliation): number[] {
  return [charId, corpId, allyId].filter((id): id is number => id != null && id > 0)
}

type AnalysisStatus = {
  revision: number
  analyzedRevision: number
  version: number
  /** Absent on rows written before the analyzer version was stored. */
  analyzerVersion?: number
  /** Published non-manual uploader sides that differ from the raw log rows. */
  uploaderSides?: string | null
}

export function needsAnalysis(status: AnalysisStatus): boolean {
  return status.revision !== status.analyzedRevision || status.analyzerVersion !== ANALYZER_VERSION || status.uploaderSides == null
}

const CHUNK_BYTES = 1024 * 1024
const SIDE_EDIT_LIMIT = 30
const SIDE_EDIT_WINDOW_MS = 60_000
const LEGACY_FIT_MUTATIONS = "(mutated IS NULL OR mutated = '[]')"

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
    const meta: BattleMeta = this.legacy
      ? JSON.parse(this.sql.exec<{ data: string }>('SELECT data FROM meta WHERE id = 1').one().data)
      : await unpackJson(this.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM meta_chunks ORDER BY seq').toArray().map(({ data }) => data))
    if (this.hasTable('meta_names')) {
      const names = this.sql.exec<{ id: number; name: string; category: string }>(
        'SELECT id, name, category FROM meta_names WHERE name IS NOT NULL',
      )
      for (const { id, name, category } of names) meta.names[id] = { name, category }
    }
    return meta
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
      if (!legacy) {
        // New rooms write current-format inputs from the first upload. Their analysis is still pending.
        this.setupAnalysis()
        this.sql.exec('UPDATE analysis_state SET analyzerVersion = ? WHERE id = 1', ANALYZER_VERSION)
      }
    })
  }

  private hasColumn(table: 'logs' | 'names' | 'fits', column: string): boolean {
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

  cachedAffiliation(kind: HistoryKind, id: number): number | null | undefined {
    if (!this.hasTable('affiliation_history')) return undefined
    return this.sql.exec<{ owner: number | null }>(
      'SELECT owner FROM affiliation_history WHERE kind = ? AND id = ?', kind, id,
    ).toArray()[0]?.owner
  }

  cacheAffiliation(kind: HistoryKind, id: number, owner: number | null): void {
    this.sql.exec(`CREATE TABLE IF NOT EXISTS affiliation_history (
      kind TEXT NOT NULL, id INTEGER NOT NULL, owner INTEGER, PRIMARY KEY (kind, id)
    )`)
    this.sql.exec('INSERT OR IGNORE INTO affiliation_history VALUES (?, ?, ?)', kind, id, owner)
  }

  private fitRows(legacyOnly = false, charId?: number): FitRow[] {
    const hasMutations = this.hasColumn('fits', 'mutated')
    const mutations = hasMutations ? 'mutated' : 'NULL AS mutated'
    const etag = this.hasColumn('fits', 'etag') ? 'etag' : 'NULL AS etag'
    const checked = legacyOnly && hasMutations && this.hasColumn('fits', 'mutationsChecked')
    const where = hasMutations && legacyOnly
      ? `WHERE ${LEGACY_FIT_MUTATIONS}${checked ? ' AND mutationsChecked = 0' : ''}`
      : ''
    const select = `SELECT charId, eft, setAt, ${mutations}, ${etag} FROM fits`
    return (charId === undefined
      ? this.sql.exec<FitRow>(`${select} ${where} ORDER BY charId`)
      : this.sql.exec<FitRow>(`${select} WHERE charId = ?`, charId)).toArray()
  }

  legacyFits(): FitEntry[] {
    return this.fitRows(true).map(({ charId, eft, setAt }) => ({ charId, eft, setAt }))
  }

  private fitsAndNames(): Pick<BattleState, 'fits' | 'names'> {
    const fits = this.fitRows().map(readFitRow)
    return { fits, names: this.nameIndex() }
  }

  fit(charId: number): VersionedFit | undefined {
    const [row] = this.fitRows(false, charId)
    return row && readFitRow(row)
  }

  private nameIndex(): NameIndex {
    const affiliation = this.hasColumn('names', 'affiliation') ? 'affiliation' : 'NULL AS affiliation'
    const rows = this.sql.exec<{ name: string; charId: number | null; side: number | null; affiliation: string | null }>(
      `SELECT name, charId, side, ${affiliation} FROM names`,
    ).toArray()
    return Object.fromEntries(rows.map(({ name, charId, side, affiliation }) => [
      name, charId === null ? null : { charId, side: side ?? -1, ...unpackAffiliation(affiliation) },
    ]))
  }

  pendingMetaNameIds(): number[] {
    if (this.hasTable('meta_names')) {
      return this.sql.exec<{ id: number }>('SELECT id FROM meta_names WHERE name IS NULL').toArray().map(({ id }) => id)
    }
    // An existing room may have indexed affiliations before recording their names by ID.
    const logs = this.logRows().map((row) => this.summarizeLog(row))
    return [...logs, ...Object.values(this.nameIndex())].flatMap((entry) => entry ? affiliationNameIds(entry) : [])
  }

  summary(meta: BattleMeta): BattleSummary {
    const { version, uploaderSides } = this.analysisStatus()
    const analyzed = JSON.parse(uploaderSides ?? '{}') as Record<number, number>
    const logs = this.logRows().map((row) => this.summarizeLog({ ...row, side: analyzed[row.charId] ?? row.side }))
    return { meta, logs, ...this.fitsAndNames(), sideOverrides: this.sideOverrides(), identityMerges: this.identityMerges(), analysisVersion: version }
  }

  async state(meta: BattleMeta): Promise<BattleState> {
    const rows = this.logRows()
    const { fits, names } = this.fitsAndNames()
    const sideOverrides = this.sideOverrides()
    const identityMerges = this.identityMerges()
    const logs: StoredLog[] = []
    // Read one JSON value at a time to cap transient decompression and parsing memory.
    for (const row of rows) logs.push(await this.getLog(row))
    return { meta, logs, fits, names, sideOverrides, identityMerges }
  }

  sideOverrides(): SideOverride[] {
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

  sideTags(subjects: readonly SideSubject[]): Array<string | null> {
    if (!this.hasTable('side_revisions')) return subjects.map(() => null)
    return subjects.map((subject) => this.sql.exec<{ tag: string }>(
      'SELECT tag FROM side_revisions WHERE subject = ?', subject,
    ).toArray()[0]?.tag ?? null)
  }

  setSides(edits: readonly SideOverride[], setAt: number, etag: string): SideOverride[] {
    return this.storage.transactionSync(() => {
      if (!this.hasTable('side_edits')) {
        this.sql.exec(`
          CREATE TABLE side_edits (id INTEGER PRIMARY KEY, setAt INTEGER NOT NULL);
          CREATE TABLE side_overrides (
            id INTEGER PRIMARY KEY, subject TEXT UNIQUE NOT NULL, side INTEGER NOT NULL, setAt INTEGER NOT NULL
          );
        `)
      }
      // A removed override still has a revision so removing it again cannot revive a stale undo.
      this.sql.exec('CREATE TABLE IF NOT EXISTS side_revisions (subject TEXT PRIMARY KEY, tag TEXT NOT NULL)')
      this.sql.exec('DELETE FROM side_edits WHERE setAt <= ?', setAt - SIDE_EDIT_WINDOW_MS)
      this.sql.exec('INSERT INTO side_edits (setAt) VALUES (?)', setAt)
      for (const { subject, side } of edits) {
        this.sql.exec('INSERT OR REPLACE INTO side_revisions (subject, tag) VALUES (?, ?)', subject, etag)
        if (side === -1) this.sql.exec('DELETE FROM side_overrides WHERE subject = ?', subject)
        else this.sql.exec('INSERT OR REPLACE INTO side_overrides (subject, side, setAt) VALUES (?, ?, ?)', subject, side, setAt)
      }
      this.markAnalysisDirty()
      return this.sideOverrides()
    })
  }

  identityMerges(): IdentityMerge[] | undefined {
    if (!this.hasTable('identity_merges')) return undefined
    return this.sql.exec<{ source: EntityKey; target: IdentityMerge['to']; setAt: number }>(
      'SELECT source, target, setAt FROM identity_merges ORDER BY rowid',
    ).toArray().map(({ source, target, setAt }) => ({ from: source, to: target, setAt }))
  }

  setIdentity(from: EntityKey, to: IdentityMerge['to'] | null, setAt: number): IdentityMerge[] {
    return this.storage.transactionSync(() => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS identity_merges (
        source TEXT PRIMARY KEY, target TEXT NOT NULL, setAt INTEGER NOT NULL
      )`)
      if (to === null) this.sql.exec('DELETE FROM identity_merges WHERE source = ?', from)
      else this.sql.exec('INSERT OR REPLACE INTO identity_merges VALUES (?, ?, ?)', from, to, setAt)
      this.markAnalysisDirty()
      return this.identityMerges()!
    })
  }

  analysisStatus(): AnalysisStatus {
    if (!this.hasTable('analysis_state')) return { revision: 0, analyzedRevision: -1, version: 0 }
    // Old schemas omit analyzerVersion, so read the row without naming that column.
    return this.sql.exec<AnalysisStatus>('SELECT * FROM analysis_state WHERE id = 1').one()
  }

  private setupAnalysis(): void {
    this.sql.exec(`
      CREATE TABLE IF NOT EXISTS analysis_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        revision INTEGER NOT NULL, analyzedRevision INTEGER NOT NULL, version INTEGER NOT NULL,
        analyzerVersion INTEGER NOT NULL DEFAULT 0, uploaderSides TEXT
      );
      INSERT OR IGNORE INTO analysis_state (id, revision, analyzedRevision, version) VALUES (1, 0, -1, 0);
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

  publishAnalysis(revision: number, chunks: PackedJson, uploaderSides: string, refresh?: AffiliationRefresh) {
    return this.storage.transactionSync(() => {
      const status = this.analysisStatus()
      if (status.revision !== revision || !needsAnalysis(status)) return undefined
      if (!this.hasTable('analysis_state')) this.setupAnalysis()
      else {
        if (status.analyzerVersion === undefined) {
          this.sql.exec('ALTER TABLE analysis_state ADD COLUMN analyzerVersion INTEGER NOT NULL DEFAULT 0')
        }
        if (status.uploaderSides === undefined) this.sql.exec('ALTER TABLE analysis_state ADD COLUMN uploaderSides TEXT')
      }
      const version = status.version + 1
      if (refresh) {
        this.ensureAffiliationColumns()
        for (const [id, entry] of refresh.assignments) {
          const packed = packAffiliation(entry)
          this.sql.exec('UPDATE logs SET side = ?, affiliation = ? WHERE charId = ?', entry.side, packed, id)
          this.sql.exec('UPDATE names SET side = ?, affiliation = ? WHERE charId = ?', entry.side, packed, id)
        }
        this.saveMetaNames(refresh.metaNames)
      }
      this.sql.exec('DELETE FROM analysis_chunks')
      chunks.forEach((data, seq) => this.sql.exec('INSERT INTO analysis_chunks VALUES (?, ?)', seq, data))
      this.sql.exec(
        'UPDATE analysis_state SET version = ?, analyzedRevision = ?, analyzerVersion = ?, uploaderSides = ? WHERE id = 1',
        version, revision, ANALYZER_VERSION, uploaderSides,
      )
      return { version, uploaderSidesChanged: uploaderSides !== (status.uploaderSides ?? '{}') }
    })
  }

  private ensureAffiliationColumns(): void {
    if (!this.hasColumn('logs', 'affiliation')) this.sql.exec('ALTER TABLE logs ADD COLUMN affiliation TEXT')
    if (!this.hasColumn('names', 'affiliation')) this.sql.exec('ALTER TABLE names ADD COLUMN affiliation TEXT')
  }

  private saveMetaNames(metaNames: MetaNameResolution): void {
    this.sql.exec('CREATE TABLE IF NOT EXISTS meta_names (id INTEGER PRIMARY KEY, name TEXT, category TEXT)')
    this.sql.exec('DELETE FROM meta_names WHERE name IS NULL')
    for (const id of metaNames.pendingIds) this.sql.exec('INSERT INTO meta_names (id) VALUES (?)', id)
    for (const [id, { name, category }] of Object.entries(metaNames.names)) {
      this.sql.exec('INSERT OR REPLACE INTO meta_names (id, name, category) VALUES (?, ?, ?)', Number(id), name, category)
    }
  }

  saveLog(
    log: StoredLog,
    packed: PackedJson,
    resolution: { names: NameIndex; currentOffset: number | null; pending?: { id: string; offset: number | null } },
    metaNames: MetaNameResolution,
  ): LogSummary {
    const { charId, id, charName, side, uploadedAt, unparsedCount, parsed, corpId, allyId } = log
    const details: LogEventSummary = { first: parsed.events[0]?.t, last: parsed.events.at(-1)?.t, language: parsed.language }
    this.storage.transactionSync(() => {
      this.ensureAffiliationColumns()
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
      this.saveMetaNames(metaNames)
      this.markAnalysisDirty()
    })
    return { id, charId, charName, side, corpId, allyId, events: parsed.events.length, uploadedAt, ...details }
  }

  private ensureFitMutationColumns(): void {
    if (!this.hasColumn('fits', 'mutated')) this.sql.exec('ALTER TABLE fits ADD COLUMN mutated TEXT')
    // An old empty list can record a byte-for-byte mismatch that the normalized check would accept.
    if (!this.hasColumn('fits', 'mutationsChecked')) {
      this.sql.exec('ALTER TABLE fits ADD COLUMN mutationsChecked INTEGER NOT NULL DEFAULT 0')
    }
  }

  recoverFitMutations({ charId, eft, setAt }: FitEntry, mutated: string[]): boolean {
    return this.storage.transactionSync(() => {
      this.ensureFitMutationColumns()
      // The fit may have been edited or removed while ESI was in flight.
      return this.sql.exec(
        `UPDATE fits SET mutated = ?, mutationsChecked = 1
         WHERE charId = ? AND eft = ? AND setAt = ? AND mutationsChecked = 0 AND ${LEGACY_FIT_MUTATIONS}`,
        JSON.stringify(mutated), charId, eft, setAt,
      ).rowsWritten > 0
    })
  }

  /** Legacy fits have a null validator. An absent fit returns undefined. */
  fitEtag(charId: number): string | null | undefined {
    const etag = this.hasColumn('fits', 'etag') ? 'etag' : 'NULL AS etag'
    return this.sql.exec<{ etag: string | null }>(`SELECT ${etag} FROM fits WHERE charId = ?`, charId).toArray()[0]?.etag
  }

  setFit({ charId, eft, setAt, mutated }: FitEntry, etag: string): void {
    this.storage.transactionSync(() => {
      this.ensureFitMutationColumns()
      if (!this.hasColumn('fits', 'etag')) this.sql.exec('ALTER TABLE fits ADD COLUMN etag TEXT')
      this.sql.exec(
        `INSERT INTO fits (charId, eft, setAt, mutated, mutationsChecked, etag) VALUES (?, ?, ?, ?, 1, ?)
          ON CONFLICT(charId) DO UPDATE SET eft = excluded.eft, setAt = excluded.setAt,
            mutated = excluded.mutated, mutationsChecked = excluded.mutationsChecked, etag = excluded.etag`,
        charId, eft, setAt, JSON.stringify(mutated ?? []), etag,
      )
      this.markAnalysisDirty()
    })
  }

  deleteFit(charId: number): boolean {
    return this.storage.transactionSync(() => {
      const removed = this.sql.exec('DELETE FROM fits WHERE charId = ?', charId).rowsWritten > 0
      if (removed) this.markAnalysisDirty()
      return removed
    })
  }
}
