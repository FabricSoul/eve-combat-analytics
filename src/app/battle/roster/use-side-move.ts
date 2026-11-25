import { useState } from 'react'
import type { SideBatchEdit, SideBatchResult, SideEdit, SideOverride, SideSubject } from '@/core/contract'
import { useBattleUndo, useEditHistory } from '../undo'
import type { EditRevisions } from '../../state/battle-store'
import { api, ApiFailure, type SideReceipt } from '../../api/client'

const overwritten = '阵营划分已被其他编辑更改，无法撤销'
type Receipt = SideBatchResult & SideReceipt

export function useSideMove(brId: string, _overrides: readonly SideOverride[] = [], _version = -1) {
  const begin = useBattleUndo()
  const history = useEditHistory('side')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const keyFor = (subject: SideSubject) => `${brId}/side:${subject}`

  async function edit(save: () => Promise<Receipt>): Promise<boolean> {
    setError(null)
    setPending((n) => n + 1)
    let edit: ReturnType<typeof history.record> | undefined
    const revert = (_version: number, readRevisions: () => EditRevisions | undefined) => history.run(brId, async () => {
      if (!edit) return { unavailable: '无法撤销，未收到修改确认' }
      for (const includeRelated of [true, false]) {
        const plan = history.plan(edit, readRevisions(), includeRelated)
        if (!plan) break
        const restore = plan.changes.map(({ value: subject, through }) => ({ subject, through }))
        const tags = new Map(plan.changes.map(({ value, tag }) => [value, tag]))
        try {
          const restored = await api.restoreSides(brId, restore, tags)
          plan.commit((_, value) => ({ value, tag: restored.revision ?? null, sequence: restored.sequence }))
          return { reverted: plan.reverted }
        } catch (failure) {
          if (!(failure instanceof ApiFailure) || failure.status !== 412) throw failure
          // A linked group may have changed before its live frame arrives. Its conflict
          // must leave the original edit undoable under its own revision.
          if (!plan.includesRelated) break
        }
      }
      return { unavailable: overwritten }
    })
    const finish = begin({ label: '正在应用…', pending: true, revert })
    try {
      const applied = await history.run(brId, async () => {
        const { applied, previous, previousTags, revision, sequence, related = [] } = await save()
        if (!applied.length || !revision || !previousTags) return
        edit = history.record(finish.id, previous.map(({ subject }) => ({
          key: keyFor(subject),
          before: { value: subject, tag: previousTags[subject] ?? null },
          after: { value: subject, tag: revision, sequence },
        })), related.map(keyFor))
        return applied
      })
      const saved = edit
      if (saved && applied) {
        finish({
          label: applied.every(({ side }) => side === -1) ? '已恢复报告阵营' : '已改为所选阵营',
          revert,
          conflict: {
            label: overwritten,
            when: (state, revisions) => state.meta.brId === brId && !history.isPending(brId) && !history.canRevert(saved, revisions),
          },
        })
      } else {
        finish({ label: '阵营划分没有变化' })
      }
      return true
    } catch (failure) {
      finish()
      setError(failure instanceof ApiFailure ? failure.message : '无法改变阵营')
      return false
    } finally {
      setPending((n) => n - 1)
    }
  }

  function move(subject: SideSubject, side: SideEdit['side']): Promise<boolean> {
    return edit(async () => {
      const { revision, sequence, previous = [], previousTags, related, ...applied } = await api.putSide(brId, subject, side)
      return { applied: revision ? [applied] : [], previous, previousTags, related, revision, sequence }
    })
  }

  function moveMany(edits: SideBatchEdit['edits']): Promise<boolean> {
    return edit(() => api.putSideBatch(brId, edits))
  }

  return { move, moveMany, error, busy: pending > 0, clearError: () => setError(null) }
}
