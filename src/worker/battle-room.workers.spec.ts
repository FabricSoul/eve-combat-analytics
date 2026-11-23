/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, exports as worker } from 'cloudflare:workers'
import { evictDurableObject, runInDurableObject } from 'cloudflare:test'
import { expect, it } from 'vitest'
import type { BattleState, ServerMessage, UploadedLogSummary } from '../core/contract'
import type { Env } from './index'
import { brId, end, meta, now, parseGamelog, start, teams } from './test/entry'

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {}
    interface GlobalProps {
      mainModule: typeof import('./test/entry')
    }
  }
}
type WorkerEnv = Env

const base = 'https://example.com/api/battles'
const battle = (id: string) => `${base}/${id}`
const testId = (n: number) => n.toString(16).padStart(24, '0')

function create(brUrl: string) {
  return worker.default.fetch(base, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ brUrl }),
  })
}

async function prepare(n: number) {
  const id = testId(n)
  const response = await create(id)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ brId: id })
  return id
}

function upload(id: string, text: string | ReadableStream<Uint8Array>) {
  return worker.default.fetch(`${battle(id)}/logs`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: text,
  })
}

function setFit(id: string, eft: string) {
  return worker.default.fetch(`${battle(id)}/fits/100`, { method: 'PUT', body: eft })
}

async function state(id: string): Promise<BattleState> {
  const response = await worker.default.fetch(battle(id))
  expect(response.status).toBe(200)
  return response.json()
}

async function connect(id: string) {
  const response = await worker.default.fetch(`${battle(id)}/ws`, { headers: { Upgrade: 'websocket' } })
  expect(response.status).toBe(101)
  const ws = response.webSocket!
  expect(ws).toBeDefined()
  const messages: ServerMessage[] = []
  const listeners: Array<(message: ServerMessage) => void> = []
  ws.addEventListener('message', (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage
    const listener = listeners.shift()
    if (listener) listener(message)
    else messages.push(message)
  })
  ws.accept()
  return {
    next: () => {
      const message = messages.shift()
      return message ? Promise.resolve(message) : new Promise<ServerMessage>((resolve) => listeners.push(resolve))
    },
    close: () => ws.close(1000),
  }
}

it('creates one room from a BR URL and persists creation across instance eviction', async () => {
  const url = `https://br.evetools.org/br/${brId.toUpperCase()}`
  const responses = await Promise.all([create(url), create(brId)])
  for (const response of responses) {
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ brId })
  }
  const repeated = await create(brId)
  expect(repeated.status).toBe(200)
  expect(await repeated.json()).toEqual({ brId })
  await evictDurableObject(env.BATTLE.getByName(brId))
  expect(await state(brId)).toEqual({
    meta: { ...meta, teams },
    logs: [], fits: [], names: {},
  })
})

it('stores only events within inclusive windows and resolves distinct visible names in a batch', async () => {
  const id = await prepare(1)
  const text = 'valid log'
  const response = await upload(id, text)
  expect(response.status).toBe(200)
  const expectedId = Array.from(new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(text),
  )), (byte) => byte.toString(16).padStart(2, '0')).join('')
  expect(await response.json()).toEqual({
    id: expectedId, charId: 100, charName: 'Logistics Pilot', side: 1, events: 3, replaced: false,
  })
  const result = await state(id)
  expect(result.logs[0]).toMatchObject({ id: expectedId, charId: 100, uploadedAt: now, side: 1 })
  expect(result.logs[0]?.parsed.events.map((event) => event.t)).toEqual([start, start + 1, end])
  expect(result.names).toEqual({ Target: { charId: 101, side: 3 }, NPC: null })
  expect(meta.killmails.some((km) => [km.victim, ...km.attackers].some((pilot) => pilot.charId === 100))).toBe(false)
})

it.each([
  ['bad_br_url', 400, () => create('https://unrelated.test/nope')],
  ['br_not_found', 404, () => worker.default.fetch(battle(testId(505)))],
  ['br_not_found', 404, () => create('000000000000000000000404')],
  ['br_unavailable', 502, () => create('000000000000000000000502')],
  ['not_a_gamelog', 400, async () => upload(await prepare(201), 'invalid')],
  ['no_overlap', 422, async () => upload(await prepare(202), 'no overlap')],
  ['unknown_character', 422, async () => upload(await prepare(203), 'unknown')],
  ['bad_eft', 400, async () => setFit(await prepare(204), '[Ship]')],
  ['too_large', 413, async () => upload(await prepare(205), 'x'.repeat(10 * 1024 * 1024 + 1))],
  ['too_large', 413, async () => upload(await prepare(206), new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < 11; i++) controller.enqueue(new Uint8Array(1024 * 1024))
      controller.close()
    },
  }))],
] as const)('returns %s with status %i', async (error, status, call) => {
  const response = await call()
  expect(response.status).toBe(status)
  expect(await response.json()).toEqual({ error, message: expect.any(String) })
})

it('broadcasts only new uploads to both hibernating viewers and snapshots current state for a new viewer', async () => {
  const id = await prepare(2)
  const first = await connect(id)
  const second = await connect(id)
  try {
    const empty = { type: 'snapshot', state: await state(id) }
    expect(await first.next()).toEqual(empty)
    expect(await second.next()).toEqual(empty)
    await evictDurableObject(env.BATTLE.getByName(id))
    const [result, duplicate] = await Promise.all([upload(id, 'valid log'), upload(id, 'valid log')])
    expect(result.status).toBe(200)
    expect(duplicate.status).toBe(200)
    const initial = await result.json<UploadedLogSummary>()
    expect(await duplicate.json()).toEqual(initial)
    expect(initial.replaced).toBe(false)
    const added = { type: 'log_added', log: (await state(id)).logs[0], names: { Target: { charId: 101, side: 3 }, NPC: null } }
    expect(await first.next()).toEqual(added)
    expect(await second.next()).toEqual(added)
    expect(await (await upload(id, 'valid log')).json()).toEqual(initial)
    const replacement = await (await upload(id, 'replacement')).json<UploadedLogSummary>()
    expect(replacement).toMatchObject({ replaced: true, charId: 100, events: 2 })
    expect(replacement.id).not.toBe(initial.id)
    const current = await state(id)
    expect(current.logs).toHaveLength(1)
    expect(current.logs[0]?.id).toBe(replacement.id)
    expect(current.names).toEqual({ ...added.names, 'Second NPC': null })
    const replaced = { type: 'log_added', log: current.logs[0], names: { 'Second NPC': null } }
    expect(await first.next()).toEqual(replaced)
    expect(await second.next()).toEqual(replaced)
    const third = await connect(id)
    try {
      expect(await third.next()).toEqual({ type: 'snapshot', state: current })
    } finally {
      third.close()
    }
  } finally {
    first.close()
    second.close()
  }
})

it('round-trips 3,000 parsed events through SQLite after instance eviction', async () => {
  const id = await prepare(3)
  const response = await upload(id, 'long log')
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ events: 3000 })
  const stub = env.BATTLE.getByName(id)
  const stored = await runInDurableObject(stub, (_, { storage }) =>
    storage.sql.exec<{ bytes: number }>('SELECT sum(length(data)) AS bytes FROM log_chunks').one().bytes,
  )
  expect(stored).toBeGreaterThan(0)
  expect(stored).toBeLessThan(2 * 1024 * 1024)
  console.info(`3,000-event log payload in SQLite: ${stored} bytes`)
  await evictDurableObject(stub)
  expect((await state(id)).logs[0]?.parsed).toEqual(parseGamelog('long log'))
})

it('stores fit text verbatim and broadcasts the fit', async () => {
  const id = await prepare(4)
  const viewer = await connect(id)
  try {
    await viewer.next()
    const eft = '[Hurricane, [Fleet] Fit]\r\nGyrostabilizer II\r\n'
    const response = await setFit(id, eft)
    const fit = { charId: 100, eft, setAt: now }
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(fit)
    expect(await viewer.next()).toEqual({ type: 'fit_set', fit })
    await evictDurableObject(env.BATTLE.getByName(id))
    expect((await state(id)).fits).toEqual([fit])
  } finally {
    viewer.close()
  }
})
