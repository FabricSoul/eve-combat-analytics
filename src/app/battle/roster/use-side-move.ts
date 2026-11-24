import { useState } from 'react'
import type { SideEdit, SideOverride, SideSubject } from '@/core/contract'
import { useBattleUndo, visibleAfter } from '../undo'
import { api, ApiFailure } from '../../api/client'

/** Writes side assignments through PUT /sides. The new sides arrive back as sides_set over the WebSocket. */
export function useSideMove(brId: string, overrides: readonly SideOverride[] = [], version = -1) {
  const begin = useBattleUndo()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)

  async function move(subject: SideSubject, side: SideEdit['side']): Promise<boolean> {
    setError(null)
    setPending((n) => n + 1)
    const finish = begin()
    try {
      const previous = overrides.find((override) => override.subject === subject)?.side ?? -1
      const saved = await api.putSide(brId, subject, side)
      if (previous === saved.side) finish()
      else finish({
        label: saved.side === -1 ? '已恢复报告阵营' : '已改为所选阵营',
        visible: visibleAfter(version, (state) => saved.side === -1
          ? !state.sideOverrides.some((override) => override.subject === subject)
          : state.sideOverrides.some((override) => override.subject === subject && override.setAt === saved.setAt && override.side === saved.side)),
        revert: async (undoVersion) => {
          const restored = await api.putSide(brId, subject, previous)
          return visibleAfter(undoVersion, (state) => previous === -1
            ? !state.sideOverrides.some((override) => override.subject === subject)
            : state.sideOverrides.some((override) => override.subject === subject && override.setAt === restored.setAt && override.side === previous))
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

  return { move, error, busy: pending > 0, clearError: () => setError(null) }
}
