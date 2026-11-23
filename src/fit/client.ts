// Adapted from pyfa-phone's Comlink engine client (GPL-3.0-or-later).
import { wrap } from 'comlink'
import type { FitStats } from '../core/contract'
import { EftFormatError, parseEft, type ParsedEft } from './eft'

export { EftFormatError } from './eft'

export interface CalculatedFitStats extends FitStats {
  skippedLines?: string[]
}

export type FitWorkerResult = { ok: true; stats: CalculatedFitStats } | { ok: false; message: string }

export interface FitWorkerApi {
  ready(): Promise<void>
  compute(fit: ParsedEft): Promise<FitWorkerResult>
}

let session: ReturnType<typeof createSession> | undefined

function createSession() {
  const worker = new Worker(new URL('./engine.worker.ts', import.meta.url), { type: 'module' })
  const api = wrap<FitWorkerApi>(worker)
  const pending = new Set<(error: unknown) => void>()

  function dispose() {
    worker.terminate()
    if (session === next) session = undefined
  }

  function track<T>(call: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      pending.add(reject)
      void call.finally(() => pending.delete(reject)).then(resolve, reject)
    })
  }

  const next = {
    ready: track(api.ready()).catch((error: unknown) => {
      dispose()
      throw error
    }),
    compute: (fit: ParsedEft) => track<FitWorkerResult>(api.compute(fit)),
  }
  worker.addEventListener('error', (event) => {
    const error = event.error ?? new Error(event.message || 'Fit engine Worker failed')
    dispose()
    for (const reject of pending) reject(error)
    pending.clear()
  }, { once: true })
  return next
}

/** Calculate pyfa's All V, uniform-damage baseline for a pasted EFT fit. */
export async function computeFitStats(eft: string): Promise<CalculatedFitStats> {
  const fit = parseEft(eft)
  const engine = session ??= createSession()
  await engine.ready
  const result = await engine.compute(fit)
  if (!result.ok) throw new EftFormatError(result.message)
  return result.stats
}
