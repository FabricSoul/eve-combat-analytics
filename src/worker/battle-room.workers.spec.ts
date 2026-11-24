/// <reference types="@cloudflare/vitest-plugin/types" />
import { env, exports as worker } from 'cloudflare:workers'
import { evictDurableObject, runDurableObjectAlarm, runInDurableObject } from 'cloudflare:test'
import { expect, it, vi } from 'vitest'
import leshak from '../../fixtures/real/j125990-20250622/killmail-128067587.json'
import * as battleAnalysis from '../core/analysis/analyze'
import { sideOf } from '../core/br/normalize'
import type { Analysis, BattleSummary, FitEntry, KillmailFit, ServerMessage, SideOverride, UploadedLog, UploadedLogSummary, UploadResult } from '../core/contract'
import router, { createWorker } from './index'
import type { Env } from './index'
import { packJson } from './storage'
import { brId, end, largeMeta, meta, now, parseGamelog, realFightId, start, teams } from './test/entry'

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

it('creates a battle from a supported www BR link (F1 I1)', async () => {
  const id = testId(900)
  const response = await create(`https://www.br.evetools.org/br/${id}/?tab=teams#top`)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({ brId: id })
})

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

async function readLogDetail(id: string, logId: string): Promise<UploadedLog & { unparsedCount: number }> {
  const response = await worker.default.fetch(`${battle(id)}/logs/${logId}`)
  expect(response.status).toBe(200)
  expect(response.headers.get('cache-control')).toBe('public, max-age=31536000, immutable')
  return response.json()
}

const analysisUrl = (id: string) => `${battle(id)}/analysis`
// Call the public handler directly when inspecting gzip bytes. The test loopback fetch decodes Content-Encoding.
const rawAnalysis = (id: string) => router.fetch(new Request(analysisUrl(id)), env)
const MIB = 1024 * 1024

async function decodeAnalysis(response: Response): Promise<{ value: Analysis; gzipBytes: number; jsonBytes: number }> {
  expect(response.status).toBe(200)
  expect(response.headers.get('content-encoding')).toBe('gzip')
  const gzip = await response.arrayBuffer()
  expect([...new Uint8Array(gzip, 0, 2)]).toEqual([0x1f, 0x8b])
  const stream = new Blob([gzip]).stream().pipeThrough(new DecompressionStream('gzip'))
  const json = await new Response(stream).arrayBuffer()
  return {
    value: JSON.parse(new TextDecoder().decode(json)),
    gzipBytes: gzip.byteLength,
    jsonBytes: json.byteLength,
  }
}

async function state(id: string): Promise<BattleSummary> {
  const response = await worker.default.fetch(battle(id))
  expect(response.status).toBe(200)
  return response.json()
}

async function connect(id: string) {
  const response = await worker.default.fetch(`${battle(id)}/ws`, { headers: { Upgrade: 'websocket' } })
  expect(response.status).toBe(101)
  const ws = response.webSocket!
  expect(ws).toBeDefined()
  const sizes: number[] = []
  const messages: ServerMessage[] = []
  const listeners: Array<(message: ServerMessage) => void> = []
  ws.addEventListener('message', (event) => {
    const text = String(event.data)
    sizes.push(new TextEncoder().encode(text).byteLength)
    const message = JSON.parse(text) as ServerMessage
    const listener = listeners.shift()
    if (listener) listener(message)
    else messages.push(message)
  })
  ws.accept()
  return {
    sizes,
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
    logs: [], fits: [], names: {}, sideOverrides: [], analysisVersion: 0,
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
  expect(await response.json()).toMatchObject({
    id: expectedId, charId: 100, charName: 'Logistics Pilot', side: 1, events: 3, uploadedAt: now,
  })
  const result = await state(id)
  expect(result.logs[0]).toMatchObject({ id: expectedId, charId: 100, uploadedAt: now, side: 1 })
  expect(result.logs.every((log) => !('parsed' in log))).toBe(true)
  const detail = await readLogDetail(id, expectedId)
  expect(detail.parsed.events.map((event) => event.t)).toEqual([start, start + 1, end])
  expect(result.names).toEqual({ Target: { charId: 101, side: 3, corpId: 12345, allyId: null }, NPC: null })
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
    const replies = [await result.json<UploadResult>(), await duplicate.json<UploadResult>()]
    // Exactly one of two simultaneous uploads of the same file adds it; the other is told it was a duplicate.
    expect(replies.filter((reply) => reply.duplicate === true)).toHaveLength(1)
    const { duplicate: _added, ...initial } = replies.find((reply) => reply.duplicate !== true)!
    expect(initial).toMatchObject({ first: start, last: end, language: 'en' })
    expect(replies.find((reply) => reply.duplicate === true)).toEqual({ ...initial, duplicate: true })
    expect((await state(id)).logs).toEqual([initial])
    const added = { type: 'log_added', log: initial, names: { Target: { charId: 101, side: 3, corpId: 12345, allyId: null }, NPC: null } }
    expect(await first.next()).toEqual(added)
    expect(await second.next()).toEqual(added)
    expect(await (await upload(id, 'valid log')).json()).toEqual({ ...initial, duplicate: true })
    const followup = await (await upload(id, 'replacement')).json<UploadedLogSummary>()
    expect(followup).toMatchObject({ charId: 100, events: 2, first: start, last: end, language: 'en' })
    expect(followup.id).not.toBe(initial.id)
    const current = await state(id)
    expect(current.logs).toHaveLength(2)
    expect(current.names).toEqual({ ...added.names, 'Second NPC': null })
    const appended = { type: 'log_added', log: current.logs.find(({ id }) => id === followup.id), names: { 'Second NPC': null } }
    expect(await first.next()).toEqual(appended)
    expect(await second.next()).toEqual(appended)
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
  const summary = await response.json<UploadedLogSummary>()
  expect(summary.events).toBe(3000)
  const stub = env.BATTLE.getByName(id)
  const stored = await runInDurableObject(stub, (_, { storage }) =>
    storage.sql.exec<{ bytes: number }>('SELECT sum(length(data)) AS bytes FROM log_chunks').one().bytes,
  )
  expect(stored).toBeGreaterThan(0)
  expect(stored).toBeLessThan(2 * 1024 * 1024)
  console.info(`3,000-event log payload in SQLite: ${stored} bytes`)
  await evictDurableObject(stub)
  expect((await readLogDetail(id, summary.id)).parsed).toEqual(parseGamelog('long log'))
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

it('persists killmail substitutions for reload and a second live viewer, then clears them with the fit', async () => {
  const id = await prepare(990)
  const stub = env.BATTLE.getByName(id)
  const oldFit = { charId: 101, eft: '[Leshak, Old fit]', setAt: now }
  await runInDurableObject(stub, (_, { storage }) => {
    storage.sql.exec('INSERT INTO fits (charId, eft, setAt) VALUES (?, ?, ?)', oldFit.charId, oldFit.eft, oldFit.setAt)
  })
  const editor = await connect(id)
  const viewer = await connect(id)
  try {
    expect(await editor.next()).toMatchObject({ type: 'snapshot', state: { fits: [oldFit] } })
    expect(await viewer.next()).toMatchObject({ type: 'snapshot', state: { fits: [oldFit] } })
    const eft = '[Leshak, Killmail 128067587]\nEntropic Radiation Sink II'
    const mutated = ['Entropic Radiation Sink II']
    const fit = { charId: 100, eft, setAt: now, mutated }
    const saveImport = () => worker.default.fetch(`${battle(id)}/fits/100`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eft, mutated }),
    })
    const response = await saveImport()
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual(fit)
    expect(await editor.next()).toEqual({ type: 'fit_set', fit })
    expect(await viewer.next()).toEqual({ type: 'fit_set', fit })
    await evictDurableObject(stub)
    expect((await state(id)).fits).toEqual([fit, oldFit])

    const edited = { charId: 100, eft: `${eft}\nDamage Control II`, setAt: now }
    expect(await (await setFit(id, edited.eft)).json()).toEqual(edited)
    expect(await viewer.next()).toEqual({ type: 'fit_set', fit: edited })
    expect((await state(id)).fits).toEqual([edited, oldFit])

    expect(await (await saveImport()).json()).toEqual(fit)
    expect(await viewer.next()).toEqual({ type: 'fit_set', fit })
    const removed = await worker.default.fetch(`${battle(id)}/fits/100`, { method: 'DELETE' })
    expect(removed.status).toBe(200)
    expect(await viewer.next()).toEqual({ type: 'fit_removed', charId: 100 })
    expect((await state(id)).fits).toEqual([oldFit])
  } finally {
    editor.close()
    viewer.close()
  }
})

it.each([
  { room: 992, edited: false },
  { room: 993, edited: true },
])('recovers legacy fits in the background with one ESI lookup (edited: $edited)', async ({ room, edited }) => {
  const id = await prepare(room)
  const stub = env.BATTLE.getByName(id)
  const killmail = env.REAL_FIGHT_INFO.meta.killmails.find(({ id }) => id === leshak.killmail_id)!
  const esiUrl = `https://esi.evetech.net/latest/killmails/${killmail.id}/${killmail.hash}/`
  const esiFetch = vi.fn<typeof fetch>(async (input) => {
    if (input !== esiUrl) throw new Error(`Unexpected upstream request: ${String(input)}`)
    return Response.json(leshak)
  })
  const imported = await createWorker(esiFetch).fetch(
    new Request(`https://import.example/api/killmails/${killmail.id}/${killmail.hash}/fit`), env,
  )
  expect(imported.status).toBe(200)
  const { eft } = await imported.json<KillmailFit>()
  const oldFit: FitEntry = {
    charId: leshak.victim.character_id, eft: edited ? `${eft}\nDamage Control II` : eft, setAt: now - 1,
  }
  const chunks = await packJson({ ...meta, brId: id, killmails: [killmail] })
  await runInDurableObject(stub, (_, { storage }) => {
    storage.sql.exec('DELETE FROM meta_chunks')
    chunks.forEach((chunk, seq) => storage.sql.exec('INSERT INTO meta_chunks VALUES (?, ?)', seq, chunk))
    storage.sql.exec('INSERT INTO fits (charId, eft, setAt) VALUES (?, ?, ?)', oldFit.charId, oldFit.eft, oldFit.setAt)
  })

  const expected = edited ? oldFit : { ...oldFit, mutated: ['Entropic Radiation Sink II'] }
  let releaseEsi!: () => void
  const paused = new Promise<void>((resolve) => { releaseEsi = resolve })
  const reply = esiFetch.getMockImplementation()!
  esiFetch.mockClear()
  esiFetch.mockImplementation(async (...args) => {
    await paused
    return reply(...args)
  })
  vi.stubGlobal('fetch', esiFetch)
  try {
    const first = await Promise.race([state(id), scheduler.wait(1_000).then(() => undefined)])
    expect(first?.fits).toEqual([oldFit])
    await vi.waitFor(() => expect(esiFetch).toHaveBeenCalledTimes(1))

    const live = await connect(id)
    try {
      const snapshot = await live.next()
      expect(snapshot.type === 'snapshot' && snapshot.state.fits).toEqual([oldFit])
      expect((await state(id)).fits).toEqual([oldFit])
      expect(esiFetch).toHaveBeenCalledTimes(1)

      releaseEsi()
      if (!edited) expect(await live.next()).toEqual({ type: 'fit_set', fit: expected })
      await vi.waitFor(async () => {
        const row = await runInDurableObject(stub, (_, { storage }) =>
          storage.sql.exec<{ mutated: string }>('SELECT mutated FROM fits WHERE charId = ?', oldFit.charId).one(),
        )
        expect(JSON.parse(row.mutated)).toEqual(expected.mutated ?? [])
      })
    } finally {
      live.close()
    }

    await evictDurableObject(stub)
    const viewer = await connect(id)
    try {
      const snapshot = await viewer.next()
      expect(snapshot.type === 'snapshot' && snapshot.state.fits).toEqual([expected])
      expect((await state(id)).fits).toEqual([expected])
      expect(esiFetch).toHaveBeenCalledTimes(1)
    } finally {
      viewer.close()
    }
  } finally {
    releaseEsi()
    vi.unstubAllGlobals()
  }
})

it('rejects malformed substitution metadata on JSON fit saves', async () => {
  const id = await prepare(991)
  const eft = '[Leshak, Fleet]'
  for (const mutated of [null, 'module', [3], [' '], ['line\nbreak']]) {
    const response = await worker.default.fetch(`${battle(id)}/fits/100`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ eft, mutated }),
    })
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: 'bad_request' })
  }
  expect((await state(id)).fits).toEqual([])
})

it('I1 uses battle-time affiliation for uploads and counterparties on killmails', async () => {
  const id = await prepare(910)
  const pilot = meta.killmails.flatMap((km) => [km.victim, ...km.attackers])
    .find(({ charId }) => charId === 2113179297)!
  const side = sideOf(pilot, teams)
  expect(side).toBeGreaterThanOrEqual(0)
  expect(await (await upload(id, 'historical')).json()).toMatchObject({ side })
  expect((await state(id)).names['Zeikku Targaryen']).toMatchObject({ charId: 2113179297, side })
})

it('I5 stores a >3 MB BR in bounded gzip chunks and reads it back after eviction', async () => {
  const id = testId(0x1b16)
  const expected = largeMeta(id)
  expect(new TextEncoder().encode(JSON.stringify(expected)).length).toBeGreaterThan(3 * 1024 * 1024)
  expect(await (await create(id)).json()).toEqual({ brId: id })
  const stub = env.BATTLE.getByName(id)
  const lengths = await runInDurableObject(stub, (_, { storage }) => {
    const tables = storage.sql.exec<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('meta', 'meta_chunks')",
    ).toArray()
    return tables.flatMap(({ name }) => storage.sql.exec(`SELECT * FROM "${name}"`).toArray()
      .flatMap((row) => Object.values(row).flatMap((v) =>
        typeof v === 'string' ? [new TextEncoder().encode(v).length] : v instanceof ArrayBuffer ? [v.byteLength] : [])))
  })
  expect(Math.max(...lengths)).toBeLessThanOrEqual(1024 * 1024)
  expect(lengths.length).toBeGreaterThan(1)
  await evictDurableObject(stub)
  expect((await state(id)).meta).toEqual(expected)
  const ws = await worker.default.fetch(`${battle(id)}/ws`, { headers: { Upgrade: 'websocket' } })
  expect(ws.status).toBe(413)
  expect(await ws.json()).toMatchObject({ error: 'too_large' })
}, 15000)

it('I6 rejects a streamed fit after 64 KiB', async () => {
  const id = await prepare(913)
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('[Rifter, Fleet]\n'))
      controller.enqueue(new Uint8Array(64 * 1024))
      controller.close()
    },
  })
  const response = await worker.default.fetch(`${battle(id)}/fits/100`, { method: 'PUT', body })
  expect(response.status).toBe(413)
  expect(await response.json()).toMatchObject({ error: 'too_large' })
  expect((await state(id)).fits).toEqual([])
})

it('I7 skips implausible names and defers lookups over 2,000 until the next upload', async () => {
  const id = await prepare(914)
  const first = await upload(id, 'many names')
  expect(first.status).toBe(200)
  await first.json()
  const names = (await state(id)).names
  expect(Object.keys(names)).toHaveLength(2000)
  expect(Object.keys(names).every((name) => /^Candidate \d+$/.test(name))).toBe(true)
  expect(Object.hasOwn(names, 'Candidate 2000')).toBe(false)
  await evictDurableObject(env.BATTLE.getByName(id))
  const next = await upload(id, 'replacement')
  expect(next.status).toBe(200)
  expect((await state(id)).names).toHaveProperty('Candidate 2000', null)
})

it('I7 saves a log when counterparty ESI exceeds its budget and retries those names on the next upload', async () => {
  const id = await prepare(915)
  const response = await upload(id, 'slow names')
  expect(response.status).toBe(200)
  await response.json()
  expect(Object.hasOwn((await state(id)).names, 'Timed Target')).toBe(false)
  const next = await upload(id, 'replacement')
  expect(next.status).toBe(200)
  expect((await state(id)).names).toHaveProperty('Timed Target', null)
})

it('I7 preserves completed name batches when a later batch exceeds the ESI budget', async () => {
  const id = await prepare(921)
  const response = await upload(id, 'budgeted names')
  expect(response.status).toBe(200)
  await response.json()
  expect(Object.keys((await state(id)).names)).toHaveLength(500)
  const next = await upload(id, 'replacement')
  expect(next.status).toBe(200)
  await next.json()
  expect((await state(id)).names).toHaveProperty('Budget Target 549', null)
})

it('I9 keeps multiple files for one pilot and treats an exact upload as a no-op', async () => {
  const id = await prepare(917)
  const first = await upload(id, 'valid log')
  expect(first.status).toBe(200)
  const initial = await first.json<UploadedLogSummary>()
  expect(initial).not.toHaveProperty('uploaderToken')
  expect(initial).not.toHaveProperty('replaced')
  const second = await upload(id, 'replacement')
  expect(second.status).toBe(200)
  const next = await second.json<UploadedLogSummary>()
  expect(next.charId).toBe(initial.charId)
  expect(next.id).not.toBe(initial.id)
  expect(await (await upload(id, 'valid log')).json()).toEqual({ ...initial, duplicate: true })
  await evictDurableObject(env.BATTLE.getByName(id))
  expect((await state(id)).logs.map(({ id }) => id).sort()).toEqual([initial.id, next.id].sort())
  const response = await setFit(id, '[Rifter, Fleet]')
  expect(await response.json()).toEqual({ charId: 100, eft: '[Rifter, Fleet]', setAt: now })
})

it('M3 limits stored unparsed diagnostics to 500 lines while retaining their total count', async () => {
  const id = await prepare(918)
  const response = await upload(id, 'many unknown')
  const result = await response.json<UploadedLogSummary>()
  const log = await readLogDetail(id, result.id)
  expect(log.parsed.unparsed).toEqual(parseGamelog('many unknown').unparsed.slice(0, 500))
  expect(log.unparsedCount).toBe(550)
})

it('M4 does not create SQLite tables when an unknown battle is read', async () => {
  const id = testId(919)
  expect((await worker.default.fetch(battle(id))).status).toBe(404)
  const tables = await runInDurableObject(env.BATTLE.getByName(id), (_, { storage }) =>
    storage.sql.exec("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE '_cf_%'").toArray(),
  )
  expect(tables).toEqual([])
})

it('M5 uses bad_request for an invalid fit character ID or missing WebSocket upgrade', async () => {
  const id = await prepare(920)
  const fit = await worker.default.fetch(`${battle(id)}/fits/NaN`, { method: 'PUT', body: '[Rifter, Fleet]' })
  expect(fit.status).toBe(400)
  expect(await fit.json()).toMatchObject({ error: 'bad_request' })
  const ws = await worker.default.fetch(`${battle(id)}/ws`)
  expect(ws.status).toBe(426)
  expect(await ws.json()).toMatchObject({ error: 'bad_request' })
})

it('keeps files from the old one-log schema readable and migrates them on append', async () => {
  const id = testId(922)
  const originalId = 'a'.repeat(64)
  const parsed = parseGamelog('replacement')
  const [packed] = await packJson(parsed)
  const stub = env.BATTLE.getByName(id)
  await runInDurableObject(stub, (_, { storage }) => {
    storage.sql.exec(`
      CREATE TABLE meta (id INTEGER PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE logs (
        charId INTEGER PRIMARY KEY, id TEXT NOT NULL UNIQUE, charName TEXT NOT NULL,
        side INTEGER NOT NULL, uploadedAt INTEGER NOT NULL, events INTEGER NOT NULL
      );
      CREATE TABLE log_chunks (
        charId INTEGER NOT NULL REFERENCES logs(charId) ON DELETE CASCADE,
        seq INTEGER NOT NULL, data BLOB NOT NULL, PRIMARY KEY (charId, seq)
      );
      CREATE TABLE fits (charId INTEGER PRIMARY KEY, eft TEXT NOT NULL, setAt INTEGER NOT NULL);
      CREATE TABLE names (name TEXT PRIMARY KEY, charId INTEGER, side INTEGER);
    `)
    storage.sql.exec('INSERT INTO meta VALUES (1, ?)', JSON.stringify({ ...meta, brId: id, teams }))
    storage.sql.exec('INSERT INTO logs VALUES (100, ?, ?, 1, ?, ?)', originalId, parsed.listener, now, parsed.events.length)
    storage.sql.exec('INSERT INTO log_chunks VALUES (100, 0, ?)', packed!)
  })
  expect(await readLogDetail(id, originalId)).toMatchObject({ parsed })
  const uploaded = await upload(id, 'valid log')
  expect(uploaded.status).toBe(200)
  const next = await uploaded.json<UploadedLogSummary>()
  await evictDurableObject(stub)
  const current = await state(id)
  expect(current.meta.brId).toBe(id)
  expect(current.logs.map(({ id: logId }) => logId).sort()).toEqual([originalId, next.id].sort())
  expect((await readLogDetail(id, originalId)).parsed).toEqual(parsed)
})

it('acknowledges uploads before one analysis for a burst, then serves and revalidates the stored version', async () => {
  const id = await prepare(924)
  const stub = env.BATTLE.getByName(id)
  const viewer = await connect(id)
  try {
    expect(await viewer.next()).toMatchObject({ type: 'snapshot', state: { analysisVersion: 0 } })
    const pending = await worker.default.fetch(analysisUrl(id))
    expect(pending.status).toBe(503)
    expect(await pending.json()).toMatchObject({ error: 'br_unavailable' })

    for (const text of ['valid log', 'replacement']) {
      const response = await upload(id, text)
      expect(response.status).toBe(200)
      await response.json()
      expect(await viewer.next()).toMatchObject({ type: 'log_added' })
    }
    const fit = await setFit(id, '[Rifter, Fleet]')
    expect(fit.status).toBe(200)
    await fit.json()
    expect(await viewer.next()).toMatchObject({ type: 'fit_set' })
    expect((await state(id)).analysisVersion).toBe(0)
    await evictDurableObject(stub)
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await viewer.next()).toEqual({ type: 'analysis_ready', version: 1 })
    expect((await state(id)).analysisVersion).toBe(1)
    expect(await runDurableObjectAlarm(stub)).toBe(false)

    const response = await rawAnalysis(id)
    expect(response.headers.get('etag')).toBe('"v1"')
    expect((await decodeAnalysis(response)).value.interactions).not.toHaveLength(0)
    const cached = await worker.default.fetch(analysisUrl(id), { headers: { 'If-None-Match': 'W/"v1"' } })
    expect(cached.status).toBe(304)
    expect(cached.headers.get('etag')).toBe('"v1"')
    expect(await cached.text()).toBe('')

    const repeat = await upload(id, 'valid log')
    expect(repeat.status).toBe(200)
    await repeat.json()
    expect(await runDurableObjectAlarm(stub)).toBe(false)
    const updatedFit = await setFit(id, '[Rifter, Updated]')
    expect(updatedFit.status).toBe(200)
    await updatedFit.json()
    expect(await viewer.next()).toMatchObject({ type: 'fit_set' })
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await viewer.next()).toEqual({ type: 'analysis_ready', version: 2 })
    const latest = await worker.default.fetch(analysisUrl(id), { headers: { 'If-None-Match': '"v1"' } })
    expect(latest.status).toBe(200)
    expect(latest.headers.get('etag')).toBe('"v2"')
    await latest.arrayBuffer()
    expect(Math.max(...viewer.sizes)).toBeLessThan(MIB)
  } finally {
    viewer.close()
  }
})

it('sends analysis updates and a compact snapshot with forty 3,000-event logs', async () => {
  const id = await prepare(925)
  for (let i = 0; i < 39; i++) {
    const response = await upload(id, `pilot ${i}`)
    expect(response.status).toBe(200)
    await response.json()
  }
  const viewer = await connect(id)
  try {
    expect(await viewer.next()).toMatchObject({ type: 'snapshot' })
    const uploadResponse = await upload(id, 'pilot 39')
    expect(uploadResponse.status).toBe(200)
    const last = await uploadResponse.json<UploadedLogSummary>()
    expect(await viewer.next()).toEqual({ type: 'log_added', log: last, names: {} })
    expect(await runDurableObjectAlarm(env.BATTLE.getByName(id))).toBe(true)
    expect(await viewer.next()).toEqual({ type: 'analysis_ready', version: 1 })
    const forty = await connect(id)
    try {
      const summary = await state(id)
      expect(summary.logs).toHaveLength(40)
      expect(summary.logs.every((log) => log.events === 3000 && !('parsed' in log))).toBe(true)
      expect(await forty.next()).toEqual({ type: 'snapshot', state: summary })
      const largest = Math.max(...viewer.sizes, ...forty.sizes)
      expect(largest).toBeLessThan(MIB)
      console.info(`Largest 40-log WebSocket message: ${largest} bytes`)
    } finally {
      forty.close()
    }
  } finally {
    viewer.close()
  }
}, 30_000)

it('analyzes all 17 real fight logs in workerd and matches Node', async () => {
  const id = realFightId
  const createResponse = await create(id)
  expect(createResponse.status).toBe(200)
  await createResponse.json()
  const fixture = env.REAL_FIGHT_INFO
  expect(fixture.listeners).toHaveLength(17)
  for (let i = 0; i < fixture.listeners.length; i++) {
    const source = await env.REAL_FIGHT_LOGS.fetch(`https://fixture.local/${i}`)
    expect(source.status).toBe(200)
    const response = await upload(id, await source.text())
    expect(response.status, `fixture log ${i}: ${response.status === 200 ? '' : await response.text()}`).toBe(200)
    expect(await response.json()).toMatchObject({ charId: fixture.listeners[i]!.charId })
  }
  expect((await state(id)).analysisVersion).toBe(0)
  const stub = env.BATTLE.getByName(id)
  const start = Date.now()
  expect(await runDurableObjectAlarm(stub)).toBe(true)
  const elapsed = Date.now() - start
  const chunks = await runInDurableObject(stub, (_, { storage }) =>
    storage.sql.exec<{ bytes: number }>('SELECT length(data) AS bytes FROM analysis_chunks ORDER BY seq').toArray(),
  )
  expect(chunks.length).toBeGreaterThan(1)
  expect(Math.max(...chunks.map(({ bytes }) => bytes))).toBeLessThanOrEqual(MIB)
  await evictDurableObject(stub)
  const version = (await state(id)).analysisVersion
  expect(version).toBe(1)
  const response = await rawAnalysis(id)
  expect(response.headers.get('etag')).toBe('"v1"')
  const { value, gzipBytes, jsonBytes } = await decodeAnalysis(response)
  expect(value.interactions.length).toBe(fixture.expected.interactions)
  expect(gzipBytes).toBe(chunks.reduce((sum, { bytes }) => sum + bytes, 0))
  console.info(JSON.stringify({
    analysisVersion: version, interactions: value.interactions.length, gzipBytes, jsonBytes,
    workerdAlarmMs: elapsed, nodeAnalyzeMs: fixture.expected.nodeMilliseconds, nodeJsonBytes: fixture.expected.jsonBytes,
  }))
}, 90_000)

function putSide(id: string, data: unknown) {
  return worker.default.fetch(`${battle(id)}/sides`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(data),
  })
}

it('publishes the uploader side inferred by analysis in the live and persisted summaries', async () => {
  const id = await prepare(0xb83)
  const uploadResponse = await upload(id, 'side evidence')
  expect(uploadResponse.status).toBe(200)
  const log = await uploadResponse.json<UploadedLogSummary>()
  expect(log.side).toBe(1)
  const stub = env.BATTLE.getByName(id)
  const viewer = await connect(id)
  try {
    expect(await viewer.next()).toMatchObject({ type: 'snapshot', state: { logs: [{ ...log, side: 1 }] } })
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    const { value } = await decodeAnalysis(await rawAnalysis(id))
    expect(value.entities['char:100']).toMatchObject({ side: 3, sideSource: 'log' })
    expect((await state(id)).logs[0]?.side).toBe(3)
    expect(await viewer.next()).toMatchObject({ type: 'snapshot', state: { analysisVersion: 1, logs: [{ ...log, side: 3 }] } })
    expect(await viewer.next()).toEqual({ type: 'analysis_ready', version: 1 })
  } finally {
    viewer.close()
  }
  await evictDurableObject(stub)
  expect((await state(id)).logs[0]?.side).toBe(3)
  expect((await readLogDetail(id, log.id)).side).toBe(1)
})

function putSideBatch(id: string, edits: unknown) {
  return worker.default.fetch(`${battle(id)}/sides/batch`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ edits }),
  })
}

async function editSide(id: string, subject: SideOverride['subject'], side: number): Promise<SideOverride> {
  const response = await putSide(id, { subject, side })
  expect(response.status).toBe(200)
  const override = { subject, side, source: 'manual', setAt: now } satisfies SideOverride
  expect(await response.json()).toEqual(override)
  return override
}

it('F6b sets, replaces and removes effective overrides through eviction', async () => {
  const id = await prepare(960)
  const stub = env.BATTLE.getByName(id)
  const first = await editSide(id, 'corp:12345', 0)
  const alliance = await editSide(id, 'ally:1042504553', 1)
  expect((await state(id)).sideOverrides).toEqual([first, alliance])
  const replacement = await editSide(id, 'corp:12345', 2)
  await evictDurableObject(stub)
  expect((await state(id)).sideOverrides).toEqual([alliance, replacement])
  expect(await editSide(id, 'corp:12345', -1)).toMatchObject({ side: -1 })
  expect((await state(id)).sideOverrides).toEqual([alliance])
})

it('restores and reapplies a side batch with one viewer frame for each operation', async () => {
  const id = await prepare(0xb81)
  const stub = env.BATTLE.getByName(id)
  const low = await editSide(id, 'corp:12345', 1)
  const temporary = await editSide(id, 'char:100', teams.length)
  const high = await editSide(id, 'ally:1042504553', teams.length + 1)
  await editSide(id, temporary.subject, -1)
  const previous = [low, high].map(({ subject, side }) => ({ subject, side }))
  const removals = [...previous].reverse().map(({ subject }) => ({ subject, side: -1 }))
  const viewer = await connect(id)
  try {
    expect(await viewer.next()).toMatchObject({ type: 'snapshot', state: { sideOverrides: [low, high] } })
    const response = await putSideBatch(id, removals)
    expect(response.status).toBe(200)
    const applied = removals.map((edit) => ({ ...edit, setAt: now, source: 'manual' }))
    expect(await response.json()).toEqual({ applied, previous })
    expect(await viewer.next()).toEqual({ type: 'sides_set', overrides: [] })
    expect((await state(id)).sideOverrides).toEqual([])
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await viewer.next()).toEqual({ type: 'analysis_ready', version: 1 })

    const undo = await putSideBatch(id, previous)
    expect(undo.status).toBe(200)
    expect(await undo.json()).toEqual({
      applied: [low, high], previous: previous.map(({ subject }) => ({ subject, side: -1 })),
    })
    expect(await viewer.next()).toEqual({ type: 'sides_set', overrides: [low, high] })
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await viewer.next()).toEqual({ type: 'analysis_ready', version: 2 })
    await evictDurableObject(stub)
    expect((await state(id)).sideOverrides).toEqual([low, high])
  } finally {
    viewer.close()
  }
})

it('rejects an invalid batch before changing any subject', async () => {
  const id = await prepare(0xb82)
  const existing = await editSide(id, 'corp:12345', 1)
  const response = await putSideBatch(id, [{ subject: existing.subject, side: -1 }, { subject: 'char:100', side: 8 }])
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ error: 'bad_request' })
  expect((await state(id)).sideOverrides).toEqual([existing])
})

it.each([
  { subject: 'fleet:100', side: 0 },
  { subject: 'char:-100', side: 0 },
  { subject: 'ally:01', side: 0 },
  { subject: 'corp:0', side: 0 },
  { subject: 'char:100\n', side: 0 },
  { subject: 'char:9007199254740992', side: 0 },
  { subject: 100, side: 0 },
  { subject: 'char:100', side: -2 },
  { subject: 'char:100', side: teams.length + 1 },
  { subject: 'char:100', side: 0.5 },
  { subject: 'char:100', side: '0' },
  null,
].map((body, index) => ({ body, index })))('F6b rejects an invalid override payload $index', async ({ body, index }) => {
  const id = await prepare(970 + index)
  const response = await putSide(id, body)
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ error: 'bad_request' })
  expect((await state(id)).sideOverrides).toEqual([])
})

it('creates only the next side through index 7 and shrinks the limit when upper overrides are removed', async () => {
  const id = await prepare(988)
  const stub = env.BATTLE.getByName(id)
  const firstNewSide = teams.length
  const uploadResponse = await upload(id, 'valid log')
  expect(uploadResponse.status).toBe(200)
  await uploadResponse.json()
  const created = await editSide(id, 'char:100', firstNewSide)
  await evictDurableObject(stub)
  expect((await state(id)).sideOverrides).toEqual([created])
  expect(await runDurableObjectAlarm(stub)).toBe(true)
  const { value } = await decodeAnalysis(await rawAnalysis(id))
  expect(value.entities['char:100']).toMatchObject({ side: firstNewSide, sideSource: 'manual' })
  expect(value.coverage[firstNewSide]).toEqual({ side: firstNewSide, known: 1, withLog: 1 })
  expect(value.timeline.damageBySide[firstNewSide]?.reduce((sum, damage) => sum + damage, 0)).toBe(300)

  for (let side = firstNewSide + 1; side <= 7; side++) await editSide(id, `char:${100 + side}`, side)
  const capped = await putSide(id, { subject: 'char:108', side: 8 })
  expect(capped.status).toBe(400)
  expect(await capped.json()).toMatchObject({ error: 'bad_request' })

  await editSide(id, 'char:107', -1)
  await editSide(id, 'char:106', -1)
  const gap = await putSide(id, { subject: 'char:107', side: 7 })
  expect(gap.status).toBe(400)
  expect(await gap.json()).toMatchObject({ error: 'bad_request' })
  await editSide(id, 'char:106', 6)
  await editSide(id, 'char:107', 7)
})

it('accepts each existing BR side when the report already has more than eight teams', async () => {
  const id = await prepare(0x909)
  expect((await state(id)).meta.teams).toHaveLength(9)
  await editSide(id, 'char:100', 8)
  const created = await putSide(id, { subject: 'char:100', side: 'new' })
  expect(created.status).toBe(400)
  expect(await created.json()).toMatchObject({ error: 'bad_request' })
  const pastCap = await putSide(id, { subject: 'char:100', side: 9 })
  expect(pastCap.status).toBe(400)
  expect(await pastCap.json()).toMatchObject({ error: 'bad_request' })
  await editSide(id, 'char:100', -1)
})

it('atomically creates distinct sides for simultaneous new-side edits, then rejects creation at capacity', async () => {
  const id = await prepare(989)
  const firstNew = teams.length
  const add = (charId: number) => putSide(id, { subject: `char:${charId}`, side: 'new' })
  const results = await Promise.all([add(100), add(101)])
  expect(results.map(({ status }) => status)).toEqual([200, 200])
  const replies = await Promise.all(results.map((response) => response.json<SideOverride>()))
  expect(replies.map(({ side }) => side).sort((a, b) => a - b)).toEqual([firstNew, firstNew + 1])
  expect((await state(id)).sideOverrides).toEqual(expect.arrayContaining(replies))

  for (let side = firstNew + 2; side <= 7; side++) await editSide(id, `char:${100 + side}`, side)
  const response = await add(109)
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ error: 'bad_request' })
})

it('F6b rejects malformed JSON', async () => {
  const id = await prepare(982)
  const response = await worker.default.fetch(`${battle(id)}/sides`, { method: 'PUT', body: '{' })
  expect(response.status).toBe(400)
  expect(await response.json()).toMatchObject({ error: 'bad_request' })
})

it('F6b broadcasts effective edits before the coalesced analysis receives them', async () => {
  const id = await prepare(983)
  const stub = env.BATTLE.getByName(id)
  const uploadResponse = await upload(id, 'valid log')
  expect(uploadResponse.status).toBe(200)
  await uploadResponse.json()
  expect(await runDurableObjectAlarm(stub)).toBe(true)

  const analyze = vi.spyOn(battleAnalysis, 'analyze')
  const viewer = await connect(id)
  try {
    expect(await viewer.next()).toMatchObject({ type: 'snapshot', state: { sideOverrides: [], analysisVersion: 1 } })
    const first = await editSide(id, 'char:100', 0)
    expect(await viewer.next()).toEqual({ type: 'sides_set', overrides: [first] })
    const replacement = await editSide(id, 'char:100', 2)
    expect(await viewer.next()).toEqual({ type: 'sides_set', overrides: [replacement] })
    expect((await state(id)).analysisVersion).toBe(1)
    expect(analyze).not.toHaveBeenCalled()

    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await viewer.next()).toEqual({ type: 'analysis_ready', version: 2 })
    expect(analyze).toHaveBeenCalledTimes(1)
    expect(analyze).toHaveBeenCalledWith(expect.objectContaining({ sideOverrides: [replacement] }))
    expect(await runDurableObjectAlarm(stub)).toBe(false)
    const response = await rawAnalysis(id)
    expect(response.headers.get('etag')).toBe('"v2"')
    const { value } = await decodeAnalysis(response)
    expect(value.entities['char:100']).toBeDefined()
  } finally {
    analyze.mockRestore()
    viewer.close()
  }
})

it('F6b rate-limits accepted changes per battle across eviction and frees expired slots', async () => {
  const id = await prepare(984)
  const stub = env.BATTLE.getByName(id)
  for (let i = 1; i <= 30; i++) await editSide(id, `char:${i}`, 0)
  await evictDurableObject(stub)

  const response = await putSide(id, { subject: 'char:31', side: 0 })
  expect(response.status).toBe(429)
  expect(await response.json()).toMatchObject({ error: 'bad_request' })
  expect((await state(id)).sideOverrides).toHaveLength(30)
  const other = await prepare(985)
  await editSide(other, 'char:31', 0)

  await runInDurableObject(stub, (_, { storage }) => {
    storage.sql.exec('UPDATE side_edits SET setAt = ? WHERE id = 1', now - 60_000)
  })
  await editSide(id, 'char:31', 0)
  expect((await state(id)).sideOverrides).toHaveLength(31)
})

it('F6b persists ESI affiliations for uploaders and names absent from killmails', async () => {
  const id = await prepare(986)
  const response = await upload(id, 'valid log')
  expect(response.status).toBe(200)
  const summary = await response.json<UploadedLogSummary>()
  const affiliation = { corpId: 98108724, allyId: 1042504553 }
  expect(summary).toMatchObject({ charId: 100, side: 1, ...affiliation })

  await evictDurableObject(env.BATTLE.getByName(id))
  expect((await state(id)).logs).toEqual([summary])
  expect(await readLogDetail(id, summary.id)).toMatchObject(affiliation)
  expect((await state(id)).names.Target).toEqual({ charId: 101, side: 3, corpId: 12345, allyId: null })
  expect(await (await upload(id, 'valid log')).json()).toEqual({ ...summary, duplicate: true })
})

it('F6b persists battle-time affiliations for historical uploaders and names', async () => {
  const id = await prepare(987)
  const pilot = meta.killmails.flatMap((km) => [km.victim, ...km.attackers])
    .find((p) => p.charId === 2113179297 && sideOf(p, teams) >= 0)!
  const response = await upload(id, 'historical')
  expect(response.status).toBe(200)
  const summary = await response.json<UploadedLogSummary>()
  const affiliation = { corpId: pilot.corpId, allyId: pilot.allyId }
  expect(summary).toMatchObject(affiliation)
  expect(await readLogDetail(id, summary.id)).toMatchObject(affiliation)
  expect((await state(id)).names['Zeikku Targaryen']).toEqual({
    charId: pilot.charId, side: sideOf(pilot, teams), ...affiliation,
  })
})

it.each([
  [0xb71, { corpId: 98108724, allyId: null, side: 0 }],
  [0xb72, { corpId: 12345, allyId: null, side: 3 }],
] as const)('assigns log-only pilots using history at battle start, with current affiliation as a fallback (%i)', async (fixtureId, target) => {
  const id = await prepare(fixtureId)
  const response = await upload(id, 'valid log')
  expect(response.status).toBe(200)
  expect(await response.json()).toMatchObject({ charId: 100, corpId: 98108724, allyId: null, side: 0 })
  const stub = env.BATTLE.getByName(id)
  await evictDurableObject(stub)
  expect((await state(id)).names.Target).toEqual({ charId: 101, ...target })
  const history = await runInDurableObject(stub, (_, { storage }) =>
    storage.sql.exec('SELECT kind, id, owner FROM affiliation_history ORDER BY kind, id').toArray(),
  )
  expect(history).toEqual([
    { kind: 'alliance', id: 98108724, owner: null },
    { kind: 'corporation', id: 100, owner: 98108724 },
    ...(fixtureId === 0xb71 ? [{ kind: 'corporation', id: 101, owner: 98108724 }] : []),
  ])
  expect(await runDurableObjectAlarm(stub)).toBe(true)
  const analysis = (await decodeAnalysis(await rawAnalysis(id))).value
  expect(analysis.entities['char:101']).toMatchObject({ side: target.side })
})

it('backfills affiliations in a previously analyzed room and publishes the corrected snapshot', async () => {
  const id = await prepare(0xb73)
  const response = await upload(id, 'valid log')
  expect(response.status).toBe(200)
  await response.json()
  const stub = env.BATTLE.getByName(id)
  expect(await runDurableObjectAlarm(stub)).toBe(true)
  await runInDurableObject(stub, (_, { storage }) => {
    const current = JSON.stringify({ corpId: 12345, allyId: null })
    storage.sql.exec('UPDATE logs SET side = 3, affiliation = ?', current)
    storage.sql.exec('UPDATE names SET side = 3, affiliation = ? WHERE charId = 101', current)
    storage.sql.exec('UPDATE analysis_state SET analyzerVersion = 1')
    storage.sql.exec('DROP TABLE affiliation_history')
  })
  const viewer = await connect(id)
  try {
    expect(await viewer.next()).toMatchObject({ type: 'snapshot', state: { names: { Target: { side: 3 } } } })
  expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await viewer.next()).toMatchObject({
      type: 'snapshot', state: {
        analysisVersion: 2,
        logs: [expect.objectContaining({ charId: 100, side: 0, corpId: 98108724 })],
        names: { Target: { charId: 101, side: 0, corpId: 98108724, allyId: null } },
      },
    })
    expect(await viewer.next()).toEqual({ type: 'analysis_ready', version: 2 })
    expect((await decodeAnalysis(await rawAnalysis(id))).value.entities['char:101']?.side).toBe(0)
  } finally {
    viewer.close()
  }
})

it('broadcasts upload affiliation names and persists them for summaries and later snapshots', async () => {
  const id = await prepare(0xa01)
  const stub = env.BATTLE.getByName(id)
  const viewer = await connect(id)
  try {
    const before = await viewer.next()
    expect(before).toMatchObject({ type: 'snapshot', state: { logs: [] } })
    expect((await state(id)).meta.names[1000165]).toBeUndefined()
    const response = await upload(id, 'valid log')
    expect(response.status).toBe(200)
    await response.json()
    const metaNames = {
      100: { name: 'Logistics Pilot', category: 'character' },
      101: { name: 'Target', category: 'character' },
      1000165: { name: 'Hedion University', category: 'corporation' },
    }
    expect(await viewer.next()).toMatchObject({ type: 'log_added', metaNames })
    expect((await state(id)).meta.names).toMatchObject(metaNames)
    await evictDurableObject(stub)
    expect((await state(id)).meta.names).toMatchObject(metaNames)
    const later = await connect(id)
    try {
      expect(await later.next()).toMatchObject({ type: 'snapshot', state: { meta: { names: metaNames } } })
    } finally {
      later.close()
    }
  } finally {
    viewer.close()
  }
})

it('saves the upload on an ESI name failure and resolves the previously indexed corporation on a later upload', async () => {
  const id = await prepare(0xa02)
  expect((await upload(id, 'valid log')).status).toBe(200)
  expect((await state(id)).meta.names[1000165]).toBeUndefined()
  expect((await upload(id, 'replacement')).status).toBe(200)
  expect((await state(id)).meta.names[1000165]).toEqual({ name: 'Hedion University', category: 'corporation' })
})

it('validates, persists, publishes and removes identity merges across eviction', async () => {
  const id = await prepare(0x1d3)
  const stub = env.BATTLE.getByName(id)
  const put = (from: string, to: string | null) => worker.default.fetch(`${battle(id)}/identities`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from, to }),
  })
  const log = await upload(id, 'valid log')
  expect(log.status).toBe(200)
  await log.json()
  for (const [from, to] of [
    ['char:100', 'char:101'], ['name:Missing', 'char:101'], ['name:NPC', 'name:Target'],
    ['name:NPC', 'char:9999999999999999'], ['name:NPC', 'char:999999'],
  ] as const) {
    const bad = await put(from, to)
    expect(bad.status).toBe(400)
    expect(await bad.json()).toMatchObject({ error: 'bad_request' })
  }
  const viewer = await connect(id)
  try {
    expect(await viewer.next()).toMatchObject({ type: 'snapshot' })
    const ok = await put('name:NPC', 'char:101')
    expect(ok.status).toBe(200)
    const merge = { from: 'name:NPC', to: 'char:101', setAt: now }
    expect(await ok.json()).toEqual(merge)
    expect(await viewer.next()).toEqual({ type: 'identities_set', merges: [merge] })
  } finally {
    viewer.close()
  }
  await evictDurableObject(stub)
  const after = await connect(id)
  try {
    expect(await after.next()).toMatchObject({ type: 'snapshot', state: { identityMerges: [{ from: 'name:NPC', to: 'char:101' }] } })
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await after.next()).toMatchObject({ type: 'analysis_ready' })
    const { value } = await decodeAnalysis(await rawAnalysis(id))
    expect(value.entities['name:NPC']).toBeUndefined()
    expect(value.interactions.filter(({ to }) => to === 'char:101')).toHaveLength(3)
    const remove = await put('name:NPC', null)
    expect(remove.status).toBe(200)
    expect(await remove.json()).toEqual({ removed: 'name:NPC' })
    expect(await after.next()).toEqual({ type: 'identities_set', merges: [] })
    expect((await state(id)).identityMerges).toEqual([])
  } finally {
    after.close()
  }
})

it('filters known ships, drones, and charges out of ESI counterparty name batches', async () => {
  const id = await prepare(0x1d4)
  const response = await upload(id, 'type labels')
  expect(response.status).toBe(200)
  await response.json()
  // Test ESI accepts only the actual pilot in this batch. A type label
  // sent alongside Target makes the lookup fail and Target disappear.
  expect((await state(id)).names).toEqual({ Target: { charId: 101, side: 3, corpId: 12345, allyId: null } })
})

it('does not let a shared equipment bucket be merged into a pilot', async () => {
  const id = await prepare(0x1d5)
  const response = await upload(id, 'type labels')
  expect(response.status).toBe(200)
  await response.json()
  const result = await worker.default.fetch(`${battle(id)}/identities`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ from: 'name:弹药与装备', to: 'char:101' }),
  })
  expect(result.status).toBe(400)
  expect(await result.json()).toMatchObject({ error: 'bad_request' })
})

it('deletes a saved fit and broadcasts its removal to another viewer', async () => {
  const id = await prepare(987)
  const viewer = await connect(id)
  try {
    await viewer.next()
    const saved = await setFit(id, '[Rifter, Fleet]')
    expect(saved.status).toBe(200)
    await saved.json()
    expect(await viewer.next()).toMatchObject({ type: 'fit_set' })
    const remove = () => worker.default.fetch(`${battle(id)}/fits/100`, { method: 'DELETE' })
    const deleted = await remove()
    expect(deleted.status).toBe(200)
    expect(await deleted.json()).toEqual({ removed: 100 })
    expect(await viewer.next()).toEqual({ type: 'fit_removed', charId: 100 })
    expect((await state(id)).fits).toEqual([])
    expect((await remove()).status).toBe(200)
  } finally {
    viewer.close()
  }
})

it.each([
  ['analysis', false], ['summary', true], ['socket', true],
] as const)('refreshes stale analyzer output on the first %s request and keeps serving the old analysis', async (trigger, versioned) => {
  const id = await prepare(0xa50 + ['analysis', 'summary', 'socket'].indexOf(trigger))
  const stub = env.BATTLE.getByName(id)
  const uploadResponse = await upload(id, 'valid log')
  expect(uploadResponse.status).toBe(200)
  await uploadResponse.json()
  expect(await runDurableObjectAlarm(stub)).toBe(true)
  const current = (await decodeAnalysis(await rawAnalysis(id))).value
  expect(current.stats.length).toBeGreaterThan(0)
  const old = await packJson({ ...current, stats: [] })
  const viewer = await connect(id)
  try {
    expect(await viewer.next()).toMatchObject({ type: 'snapshot', state: { analysisVersion: 1 } })
    await runInDurableObject(stub, (_, { storage }) => {
      const hasAnalyzerVersion = storage.sql.exec<{ name: string }>('PRAGMA table_info(analysis_state)').toArray()
        .some(({ name }) => name === 'analyzerVersion')
      if (hasAnalyzerVersion && !versioned) storage.sql.exec('ALTER TABLE analysis_state DROP COLUMN analyzerVersion')
      if (!hasAnalyzerVersion && versioned) storage.sql.exec('ALTER TABLE analysis_state ADD COLUMN analyzerVersion INTEGER DEFAULT 0')
      if (versioned) storage.sql.exec('UPDATE analysis_state SET analyzerVersion = 0 WHERE id = 1')
      storage.sql.exec('DELETE FROM analysis_chunks')
      old.forEach((chunk, seq) => storage.sql.exec('INSERT INTO analysis_chunks VALUES (?, ?)', seq, chunk))
    })

    if (trigger === 'summary') {
      expect((await state(id)).analysisVersion).toBe(1)
    } else if (trigger === 'socket') {
      const other = await connect(id)
      try {
        expect(await other.next()).toMatchObject({ type: 'snapshot', state: { analysisVersion: 1 } })
      } finally {
        other.close()
      }
    } else {
      const oldResponse = await rawAnalysis(id)
      expect(oldResponse.headers.get('etag')).toBe('"v1"')
      expect((await decodeAnalysis(oldResponse)).value.stats).toEqual([])
    }
    expect(await runDurableObjectAlarm(stub)).toBe(true)
    expect(await viewer.next()).toEqual({ type: 'analysis_ready', version: 2 })
    const refreshed = await rawAnalysis(id)
    expect(refreshed.headers.get('etag')).toBe('"v2"')
    expect((await decodeAnalysis(refreshed)).value).toEqual(current)

    expect((await state(id)).analysisVersion).toBe(2)
    expect(await runDurableObjectAlarm(stub)).toBe(false)
  } finally {
    viewer.close()
  }
})
