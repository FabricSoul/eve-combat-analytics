import { AsyncLocalStorage } from 'node:async_hooks'
import type { Affiliation, BattleMeta, ParseGamelog } from '../core/contract'
import { fetchBattleMeta } from '../core/br/fetch'
import type { EsiDeps } from '../core/esi/client'
import { affiliations, namesToCharacters } from '../core/esi/names'
import { parseGamelog } from '../core/log/parse'
import type { Env } from './index'

export interface Services {
  parseGamelog: ParseGamelog
  fetchBattleMeta(brId: string): Promise<BattleMeta>
  namesToCharacters(names: string[], signal?: AbortSignal): Promise<Record<string, number | null>>
  affiliations(charIds: number[], signal?: AbortSignal): Promise<Affiliation[]>
  now(): number
}

export interface ServiceDeps extends EsiDeps {
  now: () => number
}

const productionSleep = (ms: number) => scheduler.wait(ms)

const defaultDeps = (): ServiceDeps => ({
  fetch: (input, init) => fetch(input, init),
  sleep: productionSleep,
  now: () => Date.now(),
})

export async function abortable<T>(signal: AbortSignal, work: () => Promise<T>): Promise<T> {
  signal.throwIfAborted()
  let onAbort!: () => void
  const abort = new Promise<never>((_, reject) => {
    onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
  })
  try {
    return await Promise.race([abort, work()])
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

/** One client per room preserves the shared ESI cooldown, with cancellation scoped to each lookup. */
export function createServices(_env: Env, deps: ServiceDeps = defaultDeps()): Services {
  const scope = new AsyncLocalStorage<AbortSignal>()
  const client: ServiceDeps = {
    now: deps.now,
    fetch: (input, init) => {
      const signal = scope.getStore()
      if (!signal) return deps.fetch(input, init)
      signal.throwIfAborted()
      return deps.fetch(input, {
        ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
      })
    },
    sleep: (ms) => {
      const signal = scope.getStore()
      if (!signal) return deps.sleep(ms)
      // The real clock wait can be canceled immediately. Injected sleeps retain their test semantics.
      return deps.sleep === productionSleep ? scheduler.wait(ms, { signal }) : abortable(signal, () => deps.sleep(ms))
    },
  }
  return {
    parseGamelog,
    fetchBattleMeta: (brId) => fetchBattleMeta(brId, client),
    namesToCharacters: (names, signal) => signal
      ? scope.run(signal, () => namesToCharacters(names, client))
      : namesToCharacters(names, client),
    affiliations: (charIds, signal) => signal
      ? scope.run(signal, () => affiliations(charIds, client))
      : affiliations(charIds, client),
    now: deps.now,
  }
}
