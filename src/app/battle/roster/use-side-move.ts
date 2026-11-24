import { useState } from 'react'
import type { SideEdit, SideOverride, SideSubject } from '@/core/contract'
import { useBattleUndo } from '../undo'
import { api, ApiFailure } from '../../api/client'

/** Writes side assignments through PUT /sides. The new sides arrive back as sides_set over the WebSocket. */
export function useSideMove(brId: string, overrides: readonly SideOverride[] = []) {
  const offerUndo = useBattleUndo()
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)

  async function move(subject: SideSubject, side: SideEdit['side']): Promise<boolean> {
    setError(null)
    setPending((n) => n + 1)
    try {
      const previous = overrides.find((override) => override.subject === subject)?.side ?? -1
      const saved = await api.putSide(brId, subject, side)
      if (previous !== saved.side) offerUndo(
        saved.side === -1 ? '已恢复报告阵营' : '已改为所选阵营',
        () => api.putSide(brId, subject, previous),
      )
      return true
    } catch (failure) {
      setError(failure instanceof ApiFailure ? failure.message : '无法改变阵营')
      return false
    } finally {
      setPending((n) => n - 1)
    }
  }

  return { move, error, busy: pending > 0, clearError: () => setError(null) }
}
