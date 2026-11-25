import { useEffect } from 'react'
import { prewarmFitEngine } from './client'

export function useFitPrewarm(analysisRendered: boolean) {
  useEffect(() => {
    if (!analysisRendered) return

    function warm() {
      // A failed background start leaves the foreground fit flow free to retry.
      void prewarmFitEngine().catch(() => {})
    }

    if (typeof window.requestIdleCallback === 'function') {
      const idle = window.requestIdleCallback(warm)
      return () => window.cancelIdleCallback(idle)
    }

    const timer = window.setTimeout(warm, 1000)
    return () => window.clearTimeout(timer)
  }, [analysisRendered])
}
