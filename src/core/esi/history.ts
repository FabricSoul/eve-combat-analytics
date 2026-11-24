import { EsiError, esiRequest, type EsiDeps } from './client'

export type HistoryKind = 'corporation' | 'alliance'

/** A history can be unordered. An absent alliance ID records leaving an alliance. */
export async function affiliationAt(kind: HistoryKind, id: number, at: number, deps: EsiDeps): Promise<number | null> {
  const path = kind === 'corporation' ? `/characters/${id}/corporationhistory/` : `/corporations/${id}/alliancehistory/`
  const rows = await esiRequest<unknown>(deps, 'GET', path)
  const invalid = () => new EsiError(200, `ESI ${path}: unexpected history response`)
  if (!Array.isArray(rows)) throw invalid()

  let latest = -Infinity
  let record = -Infinity
  let result: number | null = null
  for (const row of rows) {
    if (!row || typeof row !== 'object' || typeof row.start_date !== 'string' || !Number.isSafeInteger(row.record_id)) throw invalid()
    const start = Date.parse(row.start_date)
    const owner = row[`${kind}_id`]
    if (!Number.isFinite(start) || !(kind === 'alliance' && owner === undefined || Number.isSafeInteger(owner) && owner > 0)) throw invalid()
    if (start <= at && (start > latest || start === latest && row.record_id > record)) {
      latest = start
      record = row.record_id
      result = owner ?? null
    }
  }
  return result
}
