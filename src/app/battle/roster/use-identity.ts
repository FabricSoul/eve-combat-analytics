import { useState } from 'react'
import type { EntityKey, IdentityMerge } from '@/core/contract'
import { useLocalIdentity } from '../../state/battle-store'
import { useBattleUndo } from '../undo'
import { api, ApiFailure } from '../../api/client'

/**
 * Writes identity merges through PUT /identities. The change shows in the roster at once (applied locally, rolled back
 * if the call fails) until identities_set brings the server's list; the toast offers 撤销
 * from the first moment (undo reverts the local change and sends the removal).
 */
export function useIdentity(brId: string, merges: readonly IdentityMerge[] = [], _version = -1) {
  const begin = useBattleUndo()
  const applyLocal = useLocalIdentity()
  const [error, setError] = useState<string | null>(null)

  /** `label` is the toast text. The change shows at once and 撤销 is offered from the first moment. */
  async function put(from: EntityKey, to: IdentityMerge['to'] | null, label?: string): Promise<boolean> {
    setError(null)
    const previous = merges.find((merge) => merge.from === from)?.to ?? null
    const rollBack = applyLocal?.(from, to)
    const saving = api.putIdentity(brId, from, to)
    // The shared toast starts its clock now and offers 撤销 at once; undo reverts the local change, then sends the removal.
    const finish = begin(previous === to ? undefined : {
      label: label ?? (to ? '已合并身份' : '已取消合并'),
      revert: async () => {
        const undo = applyLocal?.(from, previous)
        try {
          await saving.catch(() => undefined)
          await api.putIdentity(brId, from, previous)
        } catch (failure) {
          undo?.()
          throw failure
        }
      },
    })
    if (previous === to) finish()
    try {
      await saving
      return true
    } catch (failure) {
      rollBack?.()
      finish()
      setError(failure instanceof ApiFailure ? failure.message : '无法保存合并')
      return false
    }
  }

  return { put, error, clearError: () => setError(null) }
}
