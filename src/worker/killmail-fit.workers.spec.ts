/// <reference types="@cloudflare/vitest-plugin/types" />
import { env } from 'cloudflare:workers'
import { expect, it, vi } from 'vitest'
import leshak from '../../fixtures/real/j125990-20250622/killmail-128067587.json'
import { createWorker } from './index'

const path = '/api/killmails/128067587/42b867dc1f91c954e728f170ca9f2e5d40a2d6eb/fit'
const request = (url: string) => new Request(`https://example.com${url}`)

it('fetches an ESI fit with the project User-Agent and serves it from cache on repeat', async () => {
  const esiFetch = vi.fn<typeof fetch>(async () => Response.json(leshak))
  const worker = createWorker(esiFetch)
  const response = await worker.fetch(request(path), env)
  expect(response.status).toBe(200)
  expect(response.headers.get('Cache-Control')).toContain('immutable')
  const fit = await response.json()
  expect(fit).toMatchObject({ killmailId: 128067587, charId: 2121605780, shipTypeId: 47271, eft: expect.stringContaining('Occult L') })
  expect(esiFetch).toHaveBeenCalledWith(
    'https://esi.evetech.net/latest/killmails/128067587/42b867dc1f91c954e728f170ca9f2e5d40a2d6eb/',
    { headers: { 'User-Agent': 'eve-combat-analytics (+https://github.com/FabricSoul/eve-combat-analytics)', Accept: 'application/json' } },
  )
  expect(await (await worker.fetch(request(`${path}?retry=1`), env)).json()).toEqual(fit)
  expect(esiFetch).toHaveBeenCalledTimes(1)
})

it('reports a missing ESI killmail without caching the error', async () => {
  const esiFetch = vi.fn<typeof fetch>(async () => new Response(null, { status: 404 }))
  const worker = createWorker(esiFetch)
  const url = path.replace('128067587', '128067588')
  for (let i = 0; i < 2; i++) {
    const response = await worker.fetch(request(url), env)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ error: 'killmail_unavailable' })
  }
  expect(esiFetch).toHaveBeenCalledTimes(2)
})
