import { useState } from 'react'
import type { SideBatchEdit, SideBatchResult, SideEdit, SideOverride, SideSubject } from '@/core/contract'
import { useBattleUndo, useEditHistory } from '../undo'
import { useOptionalBattleContext, type EditRevisions } from '../../state/battle-store'
import { api, ApiFailure, type SideReceipt } from '../../api/client'

const overwritten = '阵营划分已被其他编辑更改，无法撤销'
type Receipt = SideBatchResult & SideReceipt

export function useSideMove(brId: string, _overrides: readonly SideOverride[] = [], _version = -1) {
  const begin = useBattleUndo()
  const history = useEditHistory('side')
  const battle = useOptionalBattleContext()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)
  const keyFor = (subject: SideSubject) => `${brId}/side:${subject}`

  function conflictLabel(subjects: SideSubject[], partial = false) {
    const names = subjects.map((subject) => {
      const id = Number(subject.split(':')[1])
      return battle?.summary?.meta.names[id]?.name ?? battle?.summary?.logs.find(({ charId }) => charId === id)?.charName ?? subject
    })
    return names.length ? `${names.join('、')} 已被他人修改，${partial ? '其余可撤销' : '无法撤销'}` : overwritten
  }

  async function edit(save: () => Promise<Receipt>): Promise<boolean> {
    setError(null)
    setPending((n) => n + 1)
    let edit: ReturnType<typeof history.record> | undefined
    let batch = false
    const revert = (_version: number, readRevisions: () => EditRevisions | undefined) => history.run(brId, async () => {
      if (!edit) return { unavailable: '无法撤销，未收到修改确认' }
      let includeRelated = true
      let plan = history.plan(edit, readRevisions())
      while (plan) {
        const { excluded } = history.eligibility(edit, readRevisions())
        const restore = plan.changes.map(({ value: subject, through }) => ({ subject, through }))
        const tags = new Map(plan.changes.map(({ value, tag }) => [value, tag]))
        try {
          const restored = await api.restoreSides(brId, restore, tags)
          plan.commit((_, value) => ({ value, tag: restored.revision ?? null, sequence: restored.sequence }))
          return { reverted: plan.reverted, skipped: excluded.length ? conflictLabel(excluded) : undefined }
        } catch (failure) {
          if (!(failure instanceof ApiFailure) || failure.status !== 412) throw failure
          if (!batch && plan.changes.length === 1) break
          // The competing write may reach the server before its WebSocket frame reaches this tab.
          const snapshot = await api.getBattle(brId)
          history.observe(snapshot.editRevisions ?? [])
          let refreshed = history.plan(edit, readRevisions(), includeRelated)
          if (refreshed?.changes.length === plan.changes.length && plan.includesRelated) {
            includeRelated = false
            refreshed = history.plan(edit, readRevisions(), includeRelated)
          }
          if (!refreshed || refreshed.changes.length >= plan.changes.length) break
          plan = refreshed
        }
      }
      return { unavailable: batch ? conflictLabel(history.eligibility(edit, readRevisions()).excluded) : overwritten }
    })
    const finish = begin({ label: '正在应用…', pending: true, revert })
    try {
      const applied = await history.run(brId, async () => {
        const { applied, previous, previousTags, revision, sequence, related = [] } = await save()
        if (!applied.length || !revision || !previousTags) return
        batch = applied.length > 1
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
            status: (state, revisions) => {
              if (state.meta.brId !== brId || history.isPending(brId)) return
              const { available, excluded } = history.eligibility(saved, revisions)
              if (available && !excluded.length) return
              return {
                label: batch ? conflictLabel(excluded, available) : overwritten,
                partial: available ? true : undefined,
              }
            },
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
