import { useState } from 'react'
import type { SideSubject } from '@/core/contract'
import { api, ApiFailure } from '../../api/client'

/** Writes side assignments through PUT /sides. The new sides arrive back as sides_set over the WebSocket. */
export function useSideMove(brId: string) {
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState(0)

  async function move(subject: SideSubject, side: number): Promise<boolean> {
    setError(null)
    setPending((n) => n + 1)
    try {
      await api.putSide(brId, subject, side)
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
