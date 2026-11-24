import { useState } from 'react'
import type { EntityKey, IdentityMerge } from '@/core/contract'
import { useBattleUndo, visibleAfter } from '../undo'
import { api, ApiFailure } from '../../api/client'

/** Writes identity merges through PUT /identities. The new list arrives back as identities_set over the WebSocket. */
export function useIdentity(brId: string, merges: readonly IdentityMerge[] = [], version = -1) {
  const begin = useBattleUndo()
  const [error, setError] = useState<string | null>(null)

  async function put(from: EntityKey, to: IdentityMerge['to'] | null): Promise<boolean> {
    setError(null)
    const finish = begin()
    try {
      const previous = merges.find((merge) => merge.from === from)?.to ?? null
      const saved = await api.putIdentity(brId, from, to)
      if (previous === to) finish()
      else finish({
        label: to ? '已合并身份' : '已取消合并',
        visible: visibleAfter(version, (state) => 'removed' in saved
          ? !state.identityMerges?.some((merge) => merge.from === from)
          : !!state.identityMerges?.some((merge) => merge.from === from && merge.to === saved.to && merge.setAt === saved.setAt)),
        revert: async (undoVersion) => {
          const restored = await api.putIdentity(brId, from, previous)
          return visibleAfter(undoVersion, (state) => 'removed' in restored
            ? !state.identityMerges?.some((merge) => merge.from === from)
            : !!state.identityMerges?.some((merge) => merge.from === from && merge.to === restored.to && merge.setAt === restored.setAt))
        },
      })
      return true
    } catch (failure) {
      finish()
      setError(failure instanceof ApiFailure ? failure.message : '无法保存合并')
      return false
    }
  }

  return { put, error, clearError: () => setError(null) }
}
