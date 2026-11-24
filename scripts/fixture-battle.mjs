// Start an isolated Vite/Worker stack. External BR and ESI lookups use the real fixture.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

export const root = fileURLToPath(new URL('../', import.meta.url))
export const fixture = join(root, 'fixtures/real/j125990-20250622')
export const brId = '6b03a9aff85099ccb2b7e763'

export function launchChromium() {
  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium',
  ].find((candidate) => candidate && existsSync(candidate))
  assert.ok(executablePath, 'Install Chromium with pnpm exec playwright-core install chromium')
  return chromium.launch({ executablePath, headless: true })
}

export async function startFixtureBattle() {
  const workDir = join(root, 'build')
  await mkdir(workDir, { recursive: true })
  const scratch = await mkdtemp(join(workDir, 'fixture-worker-'))
  let server
  async function close() {
    try {
      await server?.close()
    } finally {
      await rm(scratch, { recursive: true, force: true })
    }
  }
  try {
    // Only upstream BR/ESI fetches are replaced. All browser requests reach the production routes.
    const entry = join(scratch, 'worker.ts')
    await writeFile(entry, `
import composition from '../../fixtures/real/j125990-20250622/br-${brId}.composition.json'
import esi from '../../fixtures/real/j125990-20250622/esi.json'
import { BattleRoom as ProductionRoom } from '../../src/worker/index'
import { createServices } from '../../src/worker/services'
export { default } from '../../src/worker/index'

const characters = new Map(Object.entries(esi.names)
  .filter(([, row]) => row.category === 'character')
  .map(([id, row]) => [row.name.toLowerCase(), Number(id)]))
const affiliations = new Map()
for (const [name, row] of Object.entries(esi.nameIndex)) {
  if (!row) continue
  characters.set(name.toLowerCase(), row.charId)
  if (row.corpId) affiliations.set(row.charId, row)
}
for (const row of esi.listeners) {
  characters.set(row.charName.toLowerCase(), row.charId)
  if (row.corpId) affiliations.set(row.charId, row)
}
// Project the recorded fixture affiliations onto battle start for log-only pilots.
// Killmail participants already have affiliations in the BR payload.
const kmPilots = new Set(composition.relateds.flatMap(({ kms }) => kms.flatMap(({ victim, attackers }) =>
  [victim, ...(attackers ?? [])].map(({ char }) => char))))
const corpAlliances = new Map([...affiliations].flatMap(([id, row]) =>
  kmPilots.has(id) ? [] : [[row.corpId, row.allyId]]))
const battleStart = new Date(Math.min(...composition.timings.map(({ start }) => start)) * 1000).toISOString()
export class BattleRoom extends ProductionRoom {
  protected override makeServices() {
    return createServices(this.env, {
      now: Date.now,
      sleep: (ms) => scheduler.wait(ms),
      async fetch(input, init) {
        const url = new URL(String(input))
        if (url.href === 'https://br.evetools.org/newapi/br/composition/${brId}') return Response.json(composition)
        const [, , resource, id, endpoint] = url.pathname.split('/')
        if (resource === 'characters' && endpoint === 'corporationhistory') {
          const row = affiliations.get(Number(id))
          return Response.json(row ? [{ corporation_id: row.corpId, start_date: battleStart, record_id: 1 }] : [])
        }
        if (resource === 'corporations' && endpoint === 'alliancehistory') {
          const alliance_id = corpAlliances.get(Number(id))
          return Response.json(alliance_id ? [{ alliance_id, start_date: battleStart, record_id: 1 }] : [])
        }
        const values = JSON.parse(String(init?.body))
        if (url.pathname === '/latest/universe/names/') {
          return Response.json(values.flatMap((id) => esi.names[id] ? [{ id, ...esi.names[id] }] : []))
        }
        if (url.pathname === '/latest/universe/ids/') {
          return Response.json({ characters: values.flatMap((name) => {
            const id = characters.get(name.toLowerCase())
            return id === undefined ? [] : [{ id, name }]
          }) })
        }
        if (url.pathname === '/latest/characters/affiliation/') {
          return Response.json(values.flatMap((id) => {
            const row = affiliations.get(id)
            return row ? [{ character_id: id, corporation_id: row.corpId, alliance_id: row.allyId ?? undefined }] : []
          }))
        }
        throw new Error('Unexpected upstream fixture request: ' + url.href)
      },
    })
  }
}
`)
    server = await createServer({
      root, configFile: false, logLevel: 'warn',
      plugins: [react(), tailwindcss(), cloudflare({
        config: { main: entry }, persistState: false, inspectorPort: false, remoteBindings: false,
      })],
      resolve: { alias: { '@': join(root, 'src') } },
      worker: { format: 'es' },
      server: { host: '127.0.0.1', port: 0 },
    })
    await server.listen()
    const origin = `http://127.0.0.1:${server.httpServer.address().port}`
    const seed = await fetch(`${origin}/api/battles`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ brUrl: `https://br.evetools.org/br/${brId}` }),
    })
    assert.equal(seed.status, 200, await seed.clone().text())
    assert.deepEqual(await seed.json(), { brId })

    return { origin, close }
  } catch (error) {
    await close()
    throw error
  }
}
