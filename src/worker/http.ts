import type { ApiError, ApiErrorCode } from '../core/contract'

const errorStatus: Record<ApiErrorCode, number> = {
  bad_br_url: 400,
  br_not_found: 404,
  br_unavailable: 502,
  killmail_unavailable: 502,
  not_a_gamelog: 400,
  no_overlap: 422,
  unknown_character: 422,
  bad_eft: 400,
  too_large: 413,
  bad_request: 400,
}

export class ApiFailure extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status = errorStatus[code],
  ) {
    super(message)
  }

  response(): Response {
    return Response.json({ error: this.code, message: this.message } satisfies ApiError, {
      status: this.status,
    })
  }
}

export function upstreamFailure(error: unknown): ApiFailure {
  if (error instanceof Error && 'code' in error && typeof error.code === 'string'
    && Object.hasOwn(errorStatus, error.code)) {
    return new ApiFailure(error.code as ApiErrorCode, error.message)
  }
  return new ApiFailure('br_unavailable', 'Battle data service is unavailable')
}

export function errorResponse(error: unknown): Response {
  if (error instanceof ApiFailure) return error.response()
  console.error('Battle API request failed', error)
  return new ApiFailure('br_unavailable', 'Battle API request failed', 500).response()
}

export const battlePath = /^\/api\/battles\/([a-f0-9]{24}|related-\d{1,15}-\d{12})(?:\/(.*))?$/i

export async function readText(request: Request, limit: number, message: string): Promise<string> {
  if (Number(request.headers.get('Content-Length')) > limit) {
    throw new ApiFailure('too_large', message)
  }
  if (!request.body) return ''
  const reader = request.body.getReader()
  const decoder = new TextDecoder('utf-8', { ignoreBOM: true })
  const text: string[] = []
  let bytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > limit) {
        // Cancellation can wait for the sender. The HTTP rejection does not need to wait.
        void reader.cancel().catch(() => {})
        throw new ApiFailure('too_large', message)
      }
      text.push(decoder.decode(value, { stream: true }))
    }
    text.push(decoder.decode())
    return text.join('')
  } finally {
    reader.releaseLock()
  }
}

/**
 * Whether an If-Match header names `current`, one of our own opaque revision tokens.
 * Weak comparison on purpose: Cloudflare weakens ETag to W/"…" when it compresses a response, and clients echo what they received.
 */
export function ifMatchAccepts(header: string, current: string | null): boolean {
  if (current === null) return false
  return header.split(',').some((tag) => tag.trim().replace(/^W\//i, '') === current)
}
