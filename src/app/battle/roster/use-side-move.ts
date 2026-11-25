import { useState } from 'react'
import type { SideBatchEdit, SideBatchResult, SideEdit, SideOverride, SideSubject } from '@/core/contract'
import { useBattleUndo, useEditHistory } from '../undo'
import { api, ApiFailure } from '../../api/client'

const overwritten = '阵营划分已被其他编辑更改，无法撤销'
type Receipt = SideBatchResult & { etag?: string; previousTags?: Partial<Record<SideSubject, string | null>> }

export function useSideMove(brId: string, _overrides: readonly SideOverride[] = [], _version = -1) {
  const begin = useBattleUndo()
  const history = useEditHistory('side')
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)

  async function edit(save: () => Promise<Receipt>): Promise<boolean> {
    setError(null)
    setPending((n) => n + 1)
    let edit: ReturnType<typeof history.record> | undefined
    const revert = () => history.run(brId, async () => {
      const plan = edit && history.plan(edit)
      if (!plan) return { unavailable: edit ? overwritten : '无法撤销，未收到修改确认' }
      const restore = plan.changes.map(({ value: subject, through }) => ({ subject, through }))
      const tags = new Map(plan.changes.map(({ value, tag }) => [value, tag]))
      try {
        const restored = await api.restoreSides(brId, restore, tags)
        plan.commit((_, value) => ({ value, tag: restored.etag ?? null }))
        return { reverted: plan.reverted }
      } catch (failure) {
        if (failure instanceof ApiFailure && failure.status === 412) return { unavailable: overwritten }
        throw failure
      }
    })
    const finish = begin({ label: '正在应用…', pending: true, revert })
    try {
      await history.run(brId, async () => {
        const { applied, previous, previousTags, etag } = await save()
        if (!applied.length || !etag || !previousTags) {
          finish()
          return
        }
        edit = history.record(finish.id, previous.map(({ subject }) => ({
          key: `${brId}/${subject}`,
          before: { value: subject, tag: previousTags[subject] ?? null },
          after: { value: subject, tag: etag },
        })))
        finish({
          label: applied.every(({ side }) => side === -1) ? '已恢复报告阵营' : '已改为所选阵营',
          revert,
        })
      })
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
      const { etag, previous = [], previousTags, ...applied } = await api.putSide(brId, subject, side)
      return { applied: etag ? [applied] : [], previous, previousTags, etag }
    })
  }

  function moveMany(edits: SideBatchEdit['edits']): Promise<boolean> {
    return edit(() => api.putSideBatch(brId, edits))
  }

  return { move, moveMany, error, busy: pending > 0, clearError: () => setError(null) }
}
