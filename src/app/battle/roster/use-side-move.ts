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

  async function edit(save: () => Promise<Receipt>, batch: boolean): Promise<boolean> {
    setError(null)
    setPending((n) => n + 1)
    const finish = begin()
    try {
      await history.run(brId, async () => {
        const { applied, previous, previousTags, etag } = await save()
        if (!applied.length || !etag || !previousTags) {
          finish()
          return
        }
        const bySubject = new Map(applied.map((override) => [override.subject, override]))
        const edit = history.record(finish.id, previous.map((before) => ({
          key: `${brId}/${before.subject}`,
          before: { value: before, tag: previousTags[before.subject] ?? null },
          after: { value: bySubject.get(before.subject)!, tag: etag },
        })))
        finish({
          label: applied.every(({ side }) => side === -1) ? '已恢复报告阵营' : '已改为所选阵营',
          revert: () => history.run(brId, async () => {
            const plan = history.plan(edit)
            if (!plan) return { unavailable: overwritten }
            const edits = plan.changes.map(({ value: { subject, side } }) => ({ subject, side }))
            const tags = new Map(plan.changes.map(({ value, tag }) => [value.subject, tag]))
            try {
              const single = edits[0]!
              const restored = !batch && edits.length === 1
                ? await api.putSide(brId, single.subject, single.side, tags.get(single.subject))
                  .then((result) => ({ applied: [result], etag: result.etag }))
                : await api.putSideBatch(brId, edits, tags)
              const changed = new Set(restored.applied.map(({ subject }) => subject))
              plan.commit((_, value) => ({
                value, tag: (changed.has(value.subject) ? restored.etag : undefined) ?? tags.get(value.subject)!,
              }))
              return { reverted: plan.reverted }
            } catch (failure) {
              if (failure instanceof ApiFailure && failure.status === 412) return { unavailable: overwritten }
              throw failure
            }
          }),
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
    }, false)
  }

  function moveMany(edits: SideBatchEdit['edits']): Promise<boolean> {
    return edit(() => api.putSideBatch(brId, edits), true)
  }

  return { move, moveMany, error, busy: pending > 0, clearError: () => setError(null) }
}
