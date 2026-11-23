import type { BattleRoom } from './battle-room'
import type { ApiError } from '../core/contract'
import { parseBrUrl } from '../core/br/url'
import { ApiFailure, battlePath, errorResponse } from './http'

export { BattleRoom } from './battle-room'

export interface Env {
  BATTLE: DurableObjectNamespace<BattleRoom>
  ASSETS: Fetcher
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (!url.pathname.startsWith('/api/')) return env.ASSETS.fetch(request)
    try {
      const origin = request.headers.get('Origin')
      if (origin !== null && origin !== url.origin) {
        throw new ApiFailure('br_unavailable', 'Only same-origin requests are allowed', 403)
      }
      if (request.method === 'POST' && url.pathname === '/api/battles') {
        const payload: unknown = await request.json().catch(() => null)
        const brUrl = typeof payload === 'object' && payload !== null && 'brUrl' in payload ? payload.brUrl : null
        const brId = typeof brUrl === 'string' ? parseBrUrl(brUrl) : null
        if (!brId) throw new ApiFailure('bad_br_url', 'Expected a br.evetools.org battle URL or a battle ID')
        const result = await env.BATTLE.get(env.BATTLE.idFromName(brId)).create(brId)
        if ('error' in result) throw new ApiFailure(result.error, result.message)
        return Response.json(result)
      }

      const route = battlePath.exec(url.pathname)
      const brId = route?.[1]?.toLowerCase()
      if (!brId) throw new ApiFailure('br_not_found', 'Battle API route not found')
      const room = env.BATTLE.get(env.BATTLE.idFromName(brId))
      if (request.method === 'GET' && route?.[2] === 'analysis') {
        const result = await room.readAnalysis(request.headers.get('If-None-Match'))
        if (result.status === 404) throw new ApiFailure('br_not_found', 'Battle has not been created')
        if (result.status === 503) {
          return Response.json({ error: 'br_unavailable', message: 'Battle analysis is pending' } satisfies ApiError, {
            status: 503, headers: { 'Retry-After': '2', 'Cache-Control': 'no-store' },
          })
        }
        const headers = new Headers({ ETag: result.etag, 'Cache-Control': 'no-cache' })
        if (result.status === 304) return new Response(null, { status: 304, headers })
        headers.set('Content-Type', 'application/json; charset=utf-8')
        headers.set('Content-Encoding', 'gzip')
        return new Response(result.body, { headers, encodeBody: 'manual' })
      }
      return await room.fetch(request)
    } catch (error) {
      return errorResponse(error)
    }
  },
} satisfies ExportedHandler<Env>
