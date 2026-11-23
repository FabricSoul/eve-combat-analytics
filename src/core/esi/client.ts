import type { ApiErrorCode } from '../contract'

export const ESI_BASE = 'https://esi.evetech.net/latest'
export const USER_AGENT = 'eve-combat-analytics (+https://github.com/FabricSoul/eve-combat-analytics)'

/** Network and clock, injected so tests never touch the real ones. */
export interface EsiDeps {
  fetch: typeof fetch
  /** Resolves after `ms` milliseconds. */
  sleep: (ms: number) => Promise<void>
}

/** A failure that maps onto the public API's error codes (thrown by the BR fetch). */
export class ApiFailure extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'ApiFailure'
  }
}

/** An ESI call that failed. `status` is the HTTP status, or 0 for a network failure. */
export class EsiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message)
    this.name = 'EsiError'
  }
}

const RETRY_STATUS = new Set([502, 503, 504])
const MAX_ATTEMPTS = 3
const BACKOFF_MS = 500
const ERROR_LIMIT_FLOOR = 10

/** Pending error-limit wait (ms) per deps object, honoured before that deps' next call. */
const pendingWait = new WeakMap<EsiDeps, number>()

export async function esiRequest<T = unknown>(
  deps: EsiDeps,
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${ESI_BASE}${path}${path.includes('?') ? '&' : '?'}datasource=tranquility`
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT, Accept: 'application/json' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'

  for (let attempt = 1; ; attempt++) {
    const wait = pendingWait.get(deps)
    if (wait) {
      pendingWait.delete(deps)
      await deps.sleep(wait)
    }

    let res: Response
    try {
      res = await deps.fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) })
    } catch (e) {
      throw new EsiError(0, `ESI ${method} ${path}: ${e instanceof Error ? e.message : 'network error'}`)
    }

    const remain = Number(res.headers.get('x-esi-error-limit-remain'))
    const reset = Number(res.headers.get('x-esi-error-limit-reset'))
    if (res.headers.has('x-esi-error-limit-remain') && remain < ERROR_LIMIT_FLOOR && reset > 0) {
      pendingWait.set(deps, reset * 1000)
    }

    if (res.ok) {
      try {
        return (await res.json()) as T
      } catch {
        throw new EsiError(res.status, `ESI ${method} ${path}: response is not JSON`)
      }
    }
    if (RETRY_STATUS.has(res.status) && attempt < MAX_ATTEMPTS) {
      await deps.sleep(BACKOFF_MS * 2 ** (attempt - 1))
      continue
    }
    throw new EsiError(res.status, `ESI ${method} ${path}: HTTP ${res.status}`)
  }
}
