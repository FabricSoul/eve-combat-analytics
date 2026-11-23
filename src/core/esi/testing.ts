// Test helpers for injected fetch/sleep. Not imported by production code.
export interface Call {
  url: string
  method: string
  headers: Record<string, string>
  body: unknown
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })
}

export function fakeFetch(handler: (call: Call, n: number) => Response | Promise<Response>) {
  const calls: Call[] = []
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((v, k) => (headers[k] = v))
    const call: Call = {
      url: String(input),
      method: init?.method ?? 'GET',
      headers,
      body: typeof init?.body === 'string' ? JSON.parse(init.body) : init?.body,
    }
    calls.push(call)
    return handler(call, calls.length)
  }) as typeof fetch
  return { fetch: fn, calls }
}

export function fakeSleep() {
  const sleeps: number[] = []
  return { sleep: async (ms: number) => void sleeps.push(ms), sleeps }
}
