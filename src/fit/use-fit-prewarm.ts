import { useEffect } from 'react'
import { prewarmFitEngine } from './client'

const desktopWithFinePointer = '(min-width: 1100px) and (pointer: fine)'
const slowConnections = new Set(['slow-2g', '2g', '3g'])

interface FitConnection {
  saveData?: boolean
  effectiveType?: string
}

function canPrewarmOnIdle() {
  if (!window.matchMedia?.(desktopWithFinePointer).matches) return false
  const { connection } = navigator as Navigator & { connection?: FitConnection }
  return !connection?.saveData && !slowConnections.has(connection?.effectiveType ?? '')
}

function warm() {
  // A failed background start leaves the foreground fit flow free to retry.
  void prewarmFitEngine().catch(() => {})
}

export function useFitPrewarm(analysisRendered: boolean, drawerOpen: boolean) {
  const idleAllowed = canPrewarmOnIdle()

  useEffect(() => {
    if (!analysisRendered || !idleAllowed) return

    function warmOnIdle() {
      if (canPrewarmOnIdle()) warm()
    }

    if (typeof window.requestIdleCallback === 'function') {
      const idle = window.requestIdleCallback(warmOnIdle)
      return () => window.cancelIdleCallback(idle)
    }

    const timer = window.setTimeout(warmOnIdle, 1000)
    return () => window.clearTimeout(timer)
  }, [analysisRendered, idleAllowed])

  useEffect(() => {
    if (analysisRendered && drawerOpen && !idleAllowed) warm()
  }, [analysisRendered, drawerOpen, idleAllowed])
}
