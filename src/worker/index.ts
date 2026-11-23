import { DurableObject } from 'cloudflare:workers'

export interface Env {
  BATTLE: DurableObjectNamespace<BattleRoom>
  ASSETS: Fetcher
}

/** One instance per battle (keyed by brId). Implemented in task T3. */
export class BattleRoom extends DurableObject<Env> {
  override async fetch(_request: Request): Promise<Response> {
    return Response.json({ error: 'br_unavailable', message: 'not implemented' }, { status: 501 })
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'br_unavailable', message: 'not implemented' }, { status: 501 })
    }
    return env.ASSETS.fetch(request)
  },
} satisfies ExportedHandler<Env>
