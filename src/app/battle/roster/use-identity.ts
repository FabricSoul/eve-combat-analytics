import { useState } from 'react'
import type { EntityKey, IdentityMerge } from '@/core/contract'
import { useLocalIdentity, type EditRevisions } from '../../state/battle-store'
import { useBattleUndo, useEditHistory } from '../undo'
import { api, ApiFailure } from '../../api/client'

const overwritten = '身份合并已被其他编辑更改，无法撤销'

export function useIdentity(brId: string, merges: readonly IdentityMerge[] = [], _version = -1) {
  const begin = useBattleUndo()
  const history = useEditHistory('identity')
  const applyLocal = useLocalIdentity()
  const [error, setError] = useState<string | null>(null)

  async function put(from: EntityKey, to: IdentityMerge['to'] | null, label = to ? '已合并身份' : '已取消合并'): Promise<boolean> {
    setError(null)
    const key = `${brId}/identity:${from}`
    const previous = merges.find((merge) => merge.from === from)?.to ?? null
    const rollBack = applyLocal?.(from, to)
    let edit: ReturnType<typeof history.record> | undefined
    const revert = async (_version: number, readRevisions: () => EditRevisions | undefined) => {
      const rollBackUndo = applyLocal?.(from, previous)
      return history.run(key, async () => {
        const plan = edit && history.plan(edit, readRevisions())
        if (!plan) {
          rollBackUndo?.()
          return { unavailable: edit ? overwritten : '无法撤销，未收到修改确认' }
        }
        const { value, tag } = plan.changes[0]!
        const target = value?.to ?? null
        const rollBackRestore = target === previous ? rollBackUndo : applyLocal?.(from, target)
        try {
          const restored = await api.putIdentity(brId, from, target, tag)
          rollBackRestore?.acknowledge(restored.sequence)
          plan.commit(() => ({ value: 'to' in restored ? restored : null, tag: restored.revision ?? null, sequence: restored.sequence }))
          return { reverted: plan.reverted }
        } catch (failure) {
          rollBackRestore?.()
          if (failure instanceof ApiFailure && failure.status === 412) return { unavailable: overwritten }
          throw failure
        }
      })
    }
    const finish = begin({ label, revert: previous === to ? undefined : revert })
    try {
      const savedEdit = await history.run(key, async () => {
        const { previous, previousTag, revision, sequence, ...saved } = await api.putIdentity(brId, from, to)
        rollBack?.acknowledge(sequence)
        if (!revision || previous === undefined) return
        return edit = history.record(finish.id, [{
          key,
          before: { value: previous, tag: previousTag ?? null },
          after: { value: 'to' in saved ? saved : null, tag: revision, sequence },
        }])
      })
      finish(savedEdit && {
        label, revert,
        conflict: {
          label: overwritten,
          when: (state, revisions) => state.meta.brId === brId && !history.isPending(key) && !history.canRevert(savedEdit, revisions),
        },
      })
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
