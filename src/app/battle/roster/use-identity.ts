import { useState } from 'react'
import type { EntityKey, IdentityMerge } from '@/core/contract'
import { useBattleUndo } from '../undo'
import { api, ApiFailure } from '../../api/client'

/** Writes identity merges through PUT /identities. The new list arrives back as identities_set over the WebSocket. */
export function useIdentity(brId: string, merges: readonly IdentityMerge[] = []) {
  const offerUndo = useBattleUndo()
  const [error, setError] = useState<string | null>(null)

  async function put(from: EntityKey, to: IdentityMerge['to'] | null): Promise<boolean> {
    setError(null)
    try {
      const previous = merges.find((merge) => merge.from === from)?.to ?? null
      await api.putIdentity(brId, from, to)
      if (previous !== to) offerUndo(to ? '已合并身份' : '已取消合并', () => api.putIdentity(brId, from, previous))
      return true
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : '无法保存合并')
      return false
    }
  }

  return { put, error, clearError: () => setError(null) }
}
