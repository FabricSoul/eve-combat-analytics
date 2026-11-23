import type { BattleRoom } from './battle-room'
import { ApiFailure, battlePath, errorResponse, parseBrId } from './http'

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
        const brId = parseBrId(
          typeof payload === 'object' && payload !== null && 'brUrl' in payload ? payload.brUrl : null,
        )
        if (!brId) throw new ApiFailure('bad_br_url', 'Expected a br.evetools.org battle URL or a battle ID')
        const result = await env.BATTLE.get(env.BATTLE.idFromName(brId)).create(brId)
        if ('error' in result) throw new ApiFailure(result.error, result.message)
        return Response.json(result)
      }

      const brId = battlePath.exec(url.pathname)?.[1]?.toLowerCase()
      if (!brId) throw new ApiFailure('br_not_found', 'Battle API route not found')
      return await env.BATTLE.get(env.BATTLE.idFromName(brId)).fetch(request)
    } catch (error) {
      return errorResponse(error)
    }
  },
} satisfies ExportedHandler<Env>
