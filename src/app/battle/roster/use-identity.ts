import { useState } from 'react'
import type { EntityKey, IdentityMerge } from '@/core/contract'
import { api, ApiFailure } from '../../api/client'

/** Writes identity merges through PUT /identities. The new list arrives back as identities_set over the WebSocket. */
export function useIdentity(brId: string) {
  const [error, setError] = useState<string | null>(null)

  async function put(from: EntityKey, to: IdentityMerge['to'] | null): Promise<boolean> {
    setError(null)
    try {
      await api.putIdentity(brId, from, to)
      return true
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : '无法保存合并')
      return false
    }
  }

  return { put, error, clearError: () => setError(null) }
}
