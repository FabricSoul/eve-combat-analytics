import { afterEach, expect, it, vi } from 'vitest'
import { api } from './client'

afterEach(() => vi.unstubAllGlobals())

it('uses JSON revisions for edits when a proxy weakens every response ETag', async () => {
  const revision = '"00000000-0000-0000-0000-000000000001"'
  const subject = 'corp:98108724'
  const upstream = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(Response.json({ subject, side: 1, revision }, { headers: { ETag: '"transport-only"' } }))
    .mockResolvedValueOnce(Response.json({ applied: [], revision }, { headers: { ETag: revision } }))
    .mockResolvedValueOnce(Response.json({ removed: 100, revision }, { headers: { ETag: revision } }))
  vi.stubGlobal('fetch', async (...args: Parameters<typeof fetch>) => {
    const response = await upstream(...args)
    response.headers.set('ETag', 'W/' + response.headers.get('ETag'))
    return response
  })

  const saved = await api.putSide('battle', subject, 1)
  expect(saved).toEqual({ subject, side: 1, revision })
  const weak = 'W/' + saved.revision
  const restored = await api.restoreSides('battle', [{ subject, through: weak }], new Map([[subject, weak]]))
  expect(restored.revision).toBe(revision)
  const restoration = upstream.mock.calls[1]?.[1]
  expect(new Headers(restoration?.headers).get('If-Match')).toBe(revision)
  expect(JSON.parse(String(restoration?.body))).toEqual({ restore: [{ subject, through: revision }] })
  expect(await api.deleteFit('battle', 100, weak)).toEqual({ removed: 100, revision })
  expect(new Headers(upstream.mock.calls[2]?.[1]?.headers).get('If-Match')).toBe(revision)
})
