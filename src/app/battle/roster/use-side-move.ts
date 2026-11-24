import { useState } from 'react'
import type { BattleSummary, SideBatchEdit, SideBatchResult, SideEdit, SideOverride, SideSubject } from '@/core/contract'
import { useBattleUndo, visibleAfter } from '../undo'
import { api, ApiFailure, battleApiPath } from '../../api/client'

async function putSideBatch(brId: string, edits: SideBatchEdit['edits']): Promise<SideBatchResult> {
  const response = await fetch(`${battleApiPath(brId)}/sides/batch`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ edits } satisfies SideBatchEdit),
  })
  if (response.ok) return response.json()
  const failure: unknown = await response.json().catch(() => null)
  const message = failure && typeof failure === 'object' && 'message' in failure && typeof failure.message === 'string'
    ? failure.message : '无法改变阵营'
  throw new ApiFailure('bad_request', message, response.status)
}

function sidesVisible(version: number, edits: readonly SideOverride[]) {
  return visibleAfter(version, (state: BattleSummary) => {
    const overrides = new Map(state.sideOverrides.map((override) => [override.subject, override]))
    return edits.every(({ subject, side, setAt }) => {
      const saved = overrides.get(subject)
      return side === -1 ? saved === undefined : saved?.side === side && saved.setAt === setAt
    })
  })
}

/** Side edits arrive as sides_set and become undoable when their analysis is visible. */
export function useSideMove(brId: string, overrides: readonly SideOverride[] = [], version = -1) {
  const begin = useBattleUndo()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)

  async function edit(
    save: () => Promise<SideBatchResult>,
    restore: (previous: SideBatchEdit['edits']) => Promise<SideOverride[]>,
  ): Promise<boolean> {
    setError(null)
    setPending((n) => n + 1)
    const finish = begin()
    try {
      const { applied, previous } = await save()
      if (!applied.length) finish()
      else finish({
        label: applied.every(({ side }) => side === -1) ? '已恢复报告阵营' : '已改为所选阵营',
        visible: sidesVisible(version, applied),
        revert: async (undoVersion) => {
          const restored = await restore(previous)
          if (restored.length) return sidesVisible(undoVersion, restored)
        },
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
    const previous = overrides.find((override) => override.subject === subject)?.side ?? -1
    return edit(async () => {
      const saved = await api.putSide(brId, subject, side)
      return { applied: previous === saved.side ? [] : [saved], previous: [{ subject, side: previous }] }
    }, async () => [await api.putSide(brId, subject, previous)])
  }

  function moveMany(edits: SideBatchEdit['edits']): Promise<boolean> {
    return edit(() => putSideBatch(brId, edits), async (previous) => (await putSideBatch(brId, previous)).applied)
  }

  return { move, moveMany, error, busy: pending > 0, clearError: () => setError(null) }
}
