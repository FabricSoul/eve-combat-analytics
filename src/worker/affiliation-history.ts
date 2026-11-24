import type { Affiliation } from '../core/contract'
import type { HistoryKind } from '../core/esi/history'
import { abortable, withDeadline, type Services } from './services'
import type { BattleStorage } from './storage'

const HISTORY_BATCH = 4
const BETWEEN_BATCHES_MS = 250
const HISTORY_TIMEOUT_MS = 5_000

/** Empty successful history is cached as null. Failed lookups stay absent and can be retried. */
async function history(
  kind: HistoryKind, ids: number[], at: number, store: BattleStorage, services: Services, signal: AbortSignal,
): Promise<Map<number, number | null>> {
  const found = new Map<number, number | null>()
  const missing = [...new Set(ids)].filter((id) => {
    const saved = store.cachedAffiliation(kind, id)
    if (saved === undefined) return true
    found.set(id, saved)
    return false
  })
  for (let i = 0; i < missing.length && !signal.aborted; i += HISTORY_BATCH) {
    if (i) {
      try { await services.wait(BETWEEN_BATCHES_MS, signal) }
      catch (error) { if (signal.aborted) break; throw error }
    }
    await Promise.all(missing.slice(i, i + HISTORY_BATCH).map(async (id) => {
      let owner: number | null
      try {
        owner = await abortable(signal, () => services.affiliationHistory(kind, id, at, signal))
      } catch {
        return
      }
      store.cacheAffiliation(kind, id, owner)
      found.set(id, owner)
    }))
  }
  return found
}

/** null means no corporation at the battle start. An absent result means ESI could not resolve it. */
export async function battleAffiliations(
  ids: number[], at: number, store: BattleStorage, services: Services, signal: AbortSignal,
  { historyTimeout = HISTORY_TIMEOUT_MS, allowPartial = false } = {},
): Promise<Map<number, Affiliation | null>> {
  if (!ids.length) return new Map()
  // Leave part of the upload budget available for current affiliations and names.
  const found = await withDeadline(historyTimeout, async (timeoutSignal) => {
    const deadline = AbortSignal.any([signal, timeoutSignal])
    const corporations = await history('corporation', ids, at, store, services, deadline)
    const allianceIds = [...corporations.values()].filter((id): id is number => id !== null)
    const alliances = await history('alliance', allianceIds, at, store, services, deadline)
    const result = new Map<number, Affiliation | null>()
    for (const [charId, corpId] of corporations) {
      if (corpId === null) result.set(charId, null)
      else {
        const allyId = alliances.get(corpId)
        if (allyId !== undefined) result.set(charId, { charId, corpId, allyId })
      }
    }
    return result
  })
  const unresolved = ids.filter((id) => !found.has(id))
  if (unresolved.length) {
    const current = await abortable(signal, () => services.affiliations(unresolved, signal)).catch((error: unknown) => {
      if (!allowPartial) throw error
      return []
    })
    for (const entry of current) found.set(entry.charId, entry)
  }
  return found
}
