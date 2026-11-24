import { useState } from 'react'
import type { EntityKey, IdentityMerge } from '@/core/contract'
import { useLocalIdentity } from '../../state/battle-store'
import { useBattleUndo } from '../undo'
import { api, ApiFailure } from '../../api/client'

/**
 * Writes identity merges through PUT /identities. The change shows in the roster at once (applied locally, rolled back
 * if the call fails) until identities_set brings the server's list; the toast offers 撤销 once the call has succeeded,
 * i.e. when the row change is visible and saved.
 */
export function useIdentity(brId: string, merges: readonly IdentityMerge[] = [], _version = -1) {
  const begin = useBattleUndo()
  const applyLocal = useLocalIdentity()
  const [error, setError] = useState<string | null>(null)

  async function write(from: EntityKey, to: IdentityMerge['to'] | null) {
    const rollBack = applyLocal?.(from, to)
    try {
      await api.putIdentity(brId, from, to)
    } catch (failure) {
      rollBack?.()
      throw failure
    }
  }

  async function put(from: EntityKey, to: IdentityMerge['to'] | null): Promise<boolean> {
    setError(null)
    const finish = begin()
    try {
      const previous = merges.find((merge) => merge.from === from)?.to ?? null
      await write(from, to)
      if (previous === to) finish()
      else finish({ label: to ? '已合并身份' : '已取消合并', revert: async () => { await write(from, previous) } })
      return true
    } catch (failure) {
      finish()
      setError(failure instanceof ApiFailure ? failure.message : '无法保存合并')
      return false
    }
  }

  return { put, error, clearError: () => setError(null) }
}
