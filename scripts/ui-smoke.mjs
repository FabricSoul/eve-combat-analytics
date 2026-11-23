// Verify the real Vite UI, Worker, SQLite Durable Object and WebSocket on loopback.
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { chromium } from 'playwright-core'
import { createServer } from 'vite'

const root = fileURLToPath(new URL('../', import.meta.url))
const fixture = join(root, 'fixtures/real/j125990-20250622')
const brId = '6b03a9aff85099ccb2b7e763'
const output = join(root, 'build/ui-smoke')
const route = `/b/${brId}`
const pilot = 'Blanchard2213'
const logFile = '20250622_134516_2121605780.txt'

const executablePath = [
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(),
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium',
].find((candidate) => candidate && existsSync(candidate))
assert.ok(executablePath, 'Install Chromium with pnpm exec playwright-core install chromium')

await mkdir(output, { recursive: true })
const scratch = await mkdtemp(join(root, 'build/ui-smoke-worker-'))
let server
let browser
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
export class BattleRoom extends ProductionRoom {
  protected override makeServices() {
    return createServices(this.env, {
      now: Date.now,
      sleep: (ms) => scheduler.wait(ms),
      async fetch(input, init) {
        const url = new URL(String(input))
        if (url.href === 'https://br.evetools.org/newapi/br/composition/${brId}') return Response.json(composition)
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

  browser = await chromium.launch({ executablePath, headless: true })
  async function open(width, height, colorScheme, reducedMotion = 'no-preference', query = '') {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion, serviceWorkers: 'block' })
    await context.route('**/*', async (request) => {
      // CCP image and Google font availability must have no influence on this gate.
      if (new URL(request.request().url()).origin === origin) await request.continue()
      else await request.abort()
    })
    const page = await context.newPage()
    page.setDefaultTimeout(15_000)
    const frames = []
    page.on('websocket', (socket) => {
      if (new URL(socket.url()).pathname !== `/api/battles/${brId}/ws`) return
      socket.on('framereceived', ({ payload }) => frames.push(JSON.parse(String(payload))))
    })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(origin + route + query)
    await page.getByRole('link', { name: /J125990/ }).waitFor()
    return { context, page, frames, errors }
  }

  const a = await open(1280, 800, 'dark')
  const b = await open(1280, 800, 'light')
  const bRow = b.page.locator('.roster-row').filter({ has: b.page.getByRole('button', { name: new RegExp(pilot) }).and(b.page.locator('.roster-main')) })
  await bRow.getByRole('img', { name: '没有日志', exact: true }).waitFor()
  await b.page.getByRole('link', { name: /J125990/ }).waitFor()
  const bDocument = await b.page.evaluateHandle(() => document)
  const picker = a.page.waitForEvent('filechooser')
  await a.page.getByRole('button', { name: '上传日志', exact: true }).first().click()
  await (await picker).setFiles({
    name: logFile, mimeType: 'text/plain',
    buffer: gunzipSync(await readFile(join(fixture, 'logs', `${logFile}.gz`))),
  })
  await b.page.locator('.app-topbar-meta').filter({ hasText: /日志\s*1\s*份/ }).waitFor()
  await bRow.getByRole('img', { name: '有日志', exact: true }).waitFor()
  assert.ok(b.frames.some(({ type, log }) => type === 'log_added' && log.charName === pilot))
  assert.ok(await bDocument.evaluate((original) => original === document))
  console.log(`Live upload: context B showed ${pilot} and one log without reload`)

  const aRow = a.page.locator('.roster-row').filter({ has: a.page.getByRole('button', { name: new RegExp(pilot) }).and(a.page.locator('.roster-main')) })
  const aDocument = await a.page.evaluateHandle(() => document)
  await bRow.hover()
  await bRow.getByRole('button', { name: `${pilot} 的操作` }).click()
  const sideMove = b.page.getByRole('group', { name: `移到… · ${pilot}` }).getByRole('menuitem').first()
  await sideMove.click()
  await aRow.getByText('手动', { exact: true }).waitFor()
  assert.ok(a.frames.some(({ type, overrides }) => type === 'sides_set' && overrides.some(({ subject }) => subject === 'char:2121605780')))
  assert.ok(await aDocument.evaluate((original) => original === document))
  assert.deepEqual([...a.errors, ...b.errors], [])
  console.log('Live side change: context A showed the manual override without reload')

  const tablet = await open(900, 800, 'dark')
  const rail = tablet.page.getByRole('navigation', { name: '飞行员名单' })
  const railBox = await rail.boundingBox()
  assert.equal(railBox?.width, 56, 'tablet roster rail is 56px wide')
  const replayBox = await tablet.page.getByRole('region', { name: '回放', exact: true }).boundingBox()
  const feedBox = await tablet.page.getByRole('complementary', { name: '事件流' }).boundingBox()
  assert.ok(replayBox && feedBox && feedBox.y >= replayBox.y + replayBox.height, 'tablet event feed sits below the replay')
  const railPilot = rail.getByRole('button', { name: new RegExp(pilot) })
  await railPilot.focus()
  await tablet.page.getByText(pilot, { exact: true }).waitFor()
  const tabletCompare = tablet.page.getByRole('tab', { name: '对比' })
  await tabletCompare.click()
  assert.equal((await tablet.page.getByRole('tabpanel', { name: '对比' }).boundingBox())?.x, 56)
  await tablet.page.getByRole('tab', { name: '名单' }).click()
  await railPilot.press('Enter')
  await tablet.page.getByRole('button', { name: '关闭个人详情' }).waitFor()
  await tablet.context.close()

  const phone = await open(390, 844, 'light', 'reduce')
  const phonePage = phone.page
  const feedMode = phonePage.getByRole('button', { name: '合并同类' })
  assert.ok((await feedMode.boundingBox())?.height >= 44, 'phone feed mode has a 44px touch target')
  assert.equal(await phonePage.getByRole('slider', { name: '回放时间' }).getAttribute('height'), '64')
  assert.equal((await phonePage.getByRole('banner').boundingBox())?.height, 44)
  const grip = phonePage.getByRole('slider', { name: '面板高度' })
  assert.equal(await grip.getAttribute('aria-valuetext'), '半屏')
  const handle = await grip.boundingBox()
  assert.ok(handle)
  await phonePage.mouse.move(handle.x + handle.width / 2, handle.y + 22)
  await phonePage.mouse.down()
  await phonePage.mouse.move(handle.x + handle.width / 2, handle.y - 30)
  await phonePage.mouse.up()
  assert.equal(await grip.getAttribute('aria-valuetext'), '全屏')
  const events = phonePage.getByRole('tab', { name: '事件', exact: true })
  await events.click()
  await events.press('ArrowRight')
  assert.equal(await phonePage.getByRole('tab', { name: '对比' }).getAttribute('aria-selected'), 'true')
  await grip.press('ArrowDown')
  assert.equal(await grip.getAttribute('aria-valuetext'), '半屏')
  await grip.press('Home')
  assert.equal(await grip.getAttribute('aria-valuetext'), '收起')
  await phonePage.getByRole('tab', { name: '名单' }).click()
  assert.equal(await grip.getAttribute('aria-valuetext'), '半屏')
  const phonePilot = phonePage.getByRole('button', { name: new RegExp(pilot) }).and(phonePage.locator('.roster-main'))
  await phonePilot.click()
  const detail = phonePage.getByRole('dialog', { name: '个人详情' })
  assert.deepEqual(await detail.boundingBox(), { x: 0, y: 44, width: 390, height: 800 },
    'phone pilot detail fills the page below the top bar')
  await phonePage.keyboard.press('Escape')
  await detail.waitFor({ state: 'hidden' })
  assert.ok(await phonePilot.evaluate((node) => document.activeElement === node), 'closing details restores focus')
  await phonePage.getByRole('link', { name: /J125990/ }).click()
  await phonePage.locator(`a.home-recent-row[href="${route}"]`).waitFor()
  assert.deepEqual(phone.errors, [])
  await phone.context.close()
  console.log('Responsive controls: 56px rail, phone keyboard controls and full-page detail, direct-link history')

  const restore = await fetch(`${origin}/api/battles/${brId}/sides`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ subject: 'char:2121605780', side: -1 }),
  })
  assert.equal(restore.status, 200, await restore.text())
  // Add the rest of the real logs through the API so screenshots cover the full replay.
  for (const file of (await readdir(join(fixture, 'logs'))).sort()) {
    if (!file.endsWith('.txt.gz') || file === `${logFile}.gz`) continue
    const response = await fetch(`${origin}/api/battles/${brId}/logs`, {
      method: 'POST', body: gunzipSync(await readFile(join(fixture, 'logs', file))),
    })
    assert.equal(response.status, 200, await response.text())
  }
  const finalSummary = await (await fetch(`${origin}/api/battles/${brId}`)).json()
  assert.equal(finalSummary.logs.length, 17)
  await b.page.waitForFunction((pilotName) =>
    [...document.querySelectorAll('.roster-main')].some((row) =>
      row.textContent.includes(pilotName) && row.querySelector('[aria-label="有日志"]')),
  'Numala Airuta', { timeout: 30_000 })
  await Promise.all([a.context.close(), b.context.close()])

  // Pause in the board's active replay sequence at the same time in every capture.
  const screenshotTime = Date.parse('2025-06-22T15:43:02.420Z')
  for (const [width, height, theme, motion] of [
    [1280, 800, 'dark'], [1280, 800, 'light'], [900, 800, 'dark'], [900, 800, 'light'],
    [390, 844, 'dark'], [390, 844, 'light'], [390, 844, 'dark', 'reduce'],
  ]) {
    const shot = await open(width, height, theme, motion, `?t=${screenshotTime}`)
    await shot.page.waitForFunction(() => document.querySelector('canvas') && document.querySelector('[data-timeline-chart]'))
    await shot.page.getByRole('slider', { name: '回放时间' }).waitFor()
    assert.equal(await shot.page.locator('html').getAttribute('data-appearance'), theme)
    assert.equal(await shot.page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches), motion === 'reduce')
    assert.equal(await shot.page.getByRole('slider', { name: '回放时间' }).getAttribute('aria-valuetext'), '15:43:02')
    assert.ok(await shot.page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    assert.deepEqual(shot.errors, [])
    const name = `${width}-${theme}${motion ? '-reduced-motion' : ''}.png`
    await shot.page.screenshot({ path: join(output, name), animations: 'disabled' })
    await shot.context.close()
    console.log(`Screenshot build/ui-smoke/${name}`)
  }
  console.log('UI smoke passed')
} finally {
  await browser?.close()
  await server?.close()
  await rm(scratch, { recursive: true, force: true })
}
