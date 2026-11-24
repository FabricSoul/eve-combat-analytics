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
    await page.goto(origin + route + query, { waitUntil: 'domcontentloaded' })
    await page.getByRole('link', { name: /J125990/ }).waitFor()
    assert.equal(await page.title(), 'EVE 舰队战复盘', 'browser tab title matches the product name in the top bar')
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
  await b.page.getByRole('button', { name: '撤销', exact: true }).click()
  await aRow.getByText('手动', { exact: true }).waitFor({ state: 'detached' })
  assert.ok(a.frames.some(({ type, overrides }) => type === 'sides_set' && overrides.length === 0))
  console.log('Side undo: cleared the same override for both viewers')

  // Three and four sides on real data: two organizations moved to new sides through the production API, as 新建一方 does.
  for (const [subject, side] of [['ally:99013753', 2], ['corp:98775057', 3]]) {
    const made = await fetch(`${origin}/api/battles/${brId}/sides`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject, side: 'new' }),
    })
    assert.equal(made.status, 200, await made.clone().text())
    assert.equal((await made.json()).side, side)
  }
  await a.page.getByRole('button', { name: 'C 方伤害' }).waitFor()
  await a.page.getByRole('button', { name: 'D 方伤害' }).waitFor()
  const fourSides = await (await fetch(`${origin}/api/battles/${brId}/analysis`)).json()
  assert.deepEqual(Object.keys(fourSides.timeline.damageBySide).sort(), ['0', '1', '2', '3'])
  const legend = a.page.locator('.replay-legend')
  const legendDrawer = a.page.getByRole('complementary', { name: '个人详情' })
  await legend.getByText('D 方', { exact: true }).waitFor()
  async function assertLegendInView(drawerOpen) {
    const geometry = await legend.evaluate((node) => {
      const canvas = node.closest('.replay-stage').getBoundingClientRect()
      const drawer = node.closest('.battle-layout').querySelector('.battle-drawer')?.getBoundingClientRect()
      const entries = [...node.children].map((entry) => {
        const rect = entry.getBoundingClientRect()
        return { text: entry.textContent.trim(), left: rect.left, right: rect.right, width: rect.width }
      })
      return { entries, canvasLeft: canvas.left, canvasRight: canvas.right, drawerLeft: drawer?.left }
    })
    assert.equal(geometry.entries.length, 4)
    assert.equal(geometry.entries.at(-1).text, 'D 方')
    assert.equal(geometry.drawerLeft !== undefined, drawerOpen)
    const right = Math.min(geometry.canvasRight, geometry.drawerLeft ?? Infinity)
    for (const entry of geometry.entries) {
      assert.ok(entry.width > 0 && entry.left >= geometry.canvasLeft && entry.right <= right,
        `${entry.text} fits in the exposed replay canvas with the drawer ${drawerOpen ? 'open' : 'closed'} (right ${entry.right} ≤ ${right})`)
    }
  }
  await assertLegendInView(false)
  await aRow.locator('.roster-main').click()
  await legendDrawer.waitFor()
  await assertLegendInView(true)
  await legendDrawer.getByRole('button', { name: '关闭个人详情', exact: true }).click()
  await legendDrawer.waitFor({ state: 'detached' })
  await assertLegendInView(false)
  console.log('Replay legend: all four labels fit at 1280px with the drawer open and closed')
  const noiseTrigger = a.page.locator('.replay-noise summary')
  const noisePanel = a.page.locator('.replay-noise .replay-popover')
  await noiseTrigger.click()
  await noisePanel.waitFor()
  const [triggerBox, panelBox, stageBox] = await Promise.all([
    noiseTrigger.boundingBox(), noisePanel.boundingBox(), a.page.locator('.replay-stage').boundingBox(),
  ])
  assert.ok(triggerBox && panelBox && stageBox)
  assert.ok(Math.abs(panelBox.y - triggerBox.y - triggerBox.height - 4) < 1, 'replay filters open directly below the trigger')
  assert.ok(Math.abs(panelBox.x - triggerBox.x) < 1, 'replay filters align to the trigger left edge')
  assert.ok(panelBox.x >= stageBox.x && panelBox.y + panelBox.height <= stageBox.y + stageBox.height, 'replay filters fit inside the stage')
  const misses = noisePanel.getByRole('checkbox', { name: '隐藏未命中', exact: true })
  await misses.check()
  await a.page.waitForURL((url) => url.searchParams.get('hide') === 'misses')
  await a.page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
  assert.ok((await noiseTrigger.boundingBox()).width > triggerBox.width, 'filter badge widens the trigger')
  assert.ok(Math.abs((await noisePanel.boundingBox()).x - panelBox.x) < 1, 'the open panel keeps its position when the badge appears')
  await misses.uncheck()
  await a.page.waitForURL((url) => !url.searchParams.has('hide'))
  await a.page.locator('.battle-stage .battle-timeline').dispatchEvent('pointerdown')
  await noisePanel.waitFor({ state: 'hidden' })
  console.log('Replay damage filters: stable below the trigger and dismissed by outside pointerdown')
  await a.page.getByRole('button', { name: '排边', exact: true }).click()
  const fourSidePanel = a.page.getByRole('dialog', { name: '排边' })
  const viewport = fourSidePanel.locator('.sides-viewport')
  const columns = fourSidePanel.getByRole('region', { name: '阵营列' })
  assert.equal(await viewport.getAttribute('data-more-right'), 'true', 'more columns to the right have an edge fade')
  assert.ok(await columns.evaluate((node) => node.scrollWidth > node.clientWidth))
  const scrollbar = fourSidePanel.getByRole('slider', { name: '横向滚动阵营列' })
  assert.ok((await scrollbar.boundingBox())?.height > 0, 'the four-side panel has a visible horizontal scrollbar')
  await scrollbar.press('End')
  await fourSidePanel.locator('.sides-viewport[data-more-left]:not([data-more-right])').waitFor()
  await scrollbar.press('Home')
  await fourSidePanel.locator('.sides-viewport[data-more-right]:not([data-more-left])').waitFor()
  const unassigned = fourSidePanel.getByRole('region', { name: '未分边', exact: true })
  const newSide = fourSidePanel.getByRole('region', { name: '新建一方', exact: true })
  await fourSidePanel.getByRole('region', { name: /^D 方 · / }).locator('button').last().focus()
  await a.page.keyboard.press('Tab')
  assert.ok(await unassigned.evaluate((node) => document.activeElement === node), 'Tab reaches 未分边')
  await unassigned.locator('button').last().focus()
  await a.page.keyboard.press('Tab')
  assert.ok(await newSide.evaluate((node) => document.activeElement === node), 'Tab reaches 新建一方')
  assert.ok(await columns.evaluate((node) => node.scrollLeft > 0))
  await fourSidePanel.locator('.sides-viewport[data-more-left]').waitFor()
  await fourSidePanel.getByRole('button', { name: '完成' }).click()
  console.log('Four-side panel: visible scrollbar, edge fades and keyboard access to both trailing columns')
  for (const [subject] of [['ally:99013753'], ['corp:98775057']]) {
    await fetch(`${origin}/api/battles/${brId}/sides`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ subject, side: -1 }),
    })
  }
  await a.page.getByRole('button', { name: 'C 方伤害' }).waitFor({ state: 'detached' })
  assert.deepEqual([...a.errors, ...b.errors], [])
  console.log('Four sides: two new sides from the API reached context A live, with per-side damage, then were removed')

  const tablet = await open(900, 800, 'dark')
  assert.equal(await tablet.page.locator('[data-module-area]').count(), 2)
  assert.equal(await tablet.page.locator('[data-module]').count(), 6)
  const tabletReplay = tablet.page.getByRole('region', { name: '回放', exact: true })
  const tabletFeed = tablet.page.locator('[data-module="feed"]')
  assert.ok((await tabletFeed.boundingBox()).y > (await tabletReplay.boundingBox()).y)
  await tablet.page.locator('.roster-main').filter({ hasText: pilot }).press('Enter')
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
  console.log('Responsive controls: tablet two-column modules, phone keyboard controls and full-page detail, direct-link history')

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
  const unresolved = b.page.locator('[data-module="roster"] [data-pilot-key^="ship:"]').first()
  const unresolvedKey = await unresolved.getAttribute('data-pilot-key')
  assert.ok(unresolvedKey)
  await unresolved.locator('.roster-main').click({ button: 'right' })
  await b.page.getByRole('menuitem', { name: '这是谁…' }).click()
  await b.page.getByRole('searchbox', { name: '搜索已知飞行员' }).fill(pilot)
  // Hold the new result after the worker publishes it, so the toast cannot rely on the mutation response.
  let releaseAnalysis
  const analysisHeld = new Promise((resolve) => { releaseAnalysis = resolve })
  await b.page.route(`**/api/battles/${brId}/analysis`, async (request) => {
    await analysisHeld
    await request.continue()
  })
  await b.page.locator('.identity-picker [data-result]').filter({ hasText: pilot }).click()
  await a.page.waitForFunction(async ({ id, key }) => {
    const { identityMerges } = await (await fetch(`/api/battles/${id}`)).json()
    return identityMerges?.some(({ from, to }) => from === key && to === 'char:2121605780')
  }, { id: brId, key: unresolvedKey })
  const notice = b.page.locator('[data-battle-toast]')
  // The row change is applied locally at once, so the toast offers 撤销 as soon as the mutation is saved, even while the analysis is held.
  await notice.getByText(/^已.*合并/).waitFor()
  assert.equal(await b.page.locator(`[data-module="roster"] [data-pilot-key="${unresolvedKey}"]`).count(), 0, 'merged row is gone before the analysis arrives')
  await notice.getByRole('button', { name: '撤销' }).waitFor()
  await notice.hover()
  const scrollBounds = await b.page.locator('.battle-module-scroll').boundingBox()
  const toastBounds = await notice.boundingBox()
  assert.ok(scrollBounds.y + scrollBounds.height <= toastBounds.y, `toast does not cover module rows: scroll ends ${scrollBounds.y + scrollBounds.height}, toast starts ${toastBounds.y}`)
  await b.page.screenshot({ path: join(output, 'walk2-undo-hovered.png') })
  releaseAnalysis()
  await notice.getByText(/^已.*合并/).waitFor()
  await b.page.screenshot({ path: join(output, 'walk2-undo-ready.png') })
  await b.page.getByRole('button', { name: '撤销', exact: true }).click()
  await a.page.waitForFunction(async ({ id, key }) => {
    const { identityMerges } = await (await fetch(`/api/battles/${id}`)).json()
    return !identityMerges?.some(({ from }) => from === key)
  }, { id: brId, key: unresolvedKey })
  await notice.getByText('已撤销', { exact: true }).waitFor()
  await b.page.screenshot({ path: join(output, 'walk-undo-complete.png') })
  console.log('Identity undo: merged an unidentified ship, then removed the merge through the same API')

  await bRow.locator('.roster-main').click()
  const fitDrawer = b.page.getByRole('complementary', { name: '个人详情' })
  await fitDrawer.getByRole('tab', { name: '配装', exact: true }).click()
  await fitDrawer.getByPlaceholder('[Ship, Fit name]').fill('[Leshak, smoke]')
  await fitDrawer.getByRole('button', { name: '保存配装' }).click()
  await b.page.getByRole('button', { name: '撤销', exact: true }).waitFor()
  await a.page.waitForFunction(async (id) => (await (await fetch(`/api/battles/${id}`)).json()).fits.some(({ charId }) => charId === 2121605780), brId)
  assert.ok(a.frames.some(({ type, fit }) => type === 'fit_set' && fit.charId === 2121605780))
  await b.page.getByRole('button', { name: '撤销', exact: true }).click()
  await fitDrawer.getByPlaceholder('[Ship, Fit name]').waitFor()
  await a.page.waitForFunction(async (id) => !(await (await fetch(`/api/battles/${id}`)).json()).fits.length, brId)
  assert.ok(a.frames.some(({ type, charId }) => type === 'fit_removed' && charId === 2121605780))
  console.log('Fit undo: first save and deletion reached the other viewer live')
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
    if (width > 760) {
      assert.equal(await shot.page.locator('[data-module-area]').count(), width === 1280 ? 3 : 2)
      assert.equal(await shot.page.locator('.battle-layout').getAttribute('data-density'), 'compact')
    }
    if (width === 1280 && theme === 'dark') {
      const page = shot.page
      const feed = page.locator('[data-module="feed"]')
      const hits = page.locator('[data-module="hits"]')
      const hitBar = hits.getByRole('group', { name: '命中 标题栏' })
      const left = page.locator('[data-module-area="0"]')
      const stage = page.getByRole('region', { name: '回放舞台' })
      const stageTop = (await stage.boundingBox()).y
      const columns = page.locator('[data-module-area]')
      const middle = await columns.nth(1).boundingBox()
      const first = await left.boundingBox()
      const gap = (first.x + first.width + middle.x) / 2
      const moduleScroll = page.locator('.battle-module-scroll')
      await page.mouse.move(gap, Math.min(760, first.y + 70))
      await page.mouse.wheel(0, 1600)
      await page.waitForFunction(() => document.querySelector('.battle-module-scroll').scrollTop > 0)
      assert.equal(await page.evaluate(() => window.scrollY), 0, 'wheel in a module gap leaves document scroll at 0')
      assert.equal((await page.getByRole('banner').boundingBox()).y, 0)
      assert.equal((await stage.boundingBox()).y, stageTop, 'wheel in a module gap keeps the stage pinned')
      assert.equal(await page.evaluate(() => document.scrollingElement.scrollHeight), height)
      assert.equal(await feed.locator('.battle-window-body').evaluate((node) => getComputedStyle(node).overscrollBehaviorY), 'contain')
      await page.screenshot({ path: join(output, 'walk2-gap-stage-pinned.png') })
      await moduleScroll.evaluate((node) => { node.scrollTop = 0 })
      const deepRow = page.locator('[data-module="roster"] .roster-main').last()
      const shellScroll = await deepRow.evaluate((node) => {
        node.scrollIntoView()
        const shell = node.closest('.app-shell--battle')
        return [shell.scrollTop, shell.scrollLeft]
      })
      await page.screenshot({ path: join(output, 'walk3-deep-row.png') })
      assert.deepEqual(shellScroll, [0, 0], 'scrollIntoView on a deep roster row leaves the battle shell at the origin')
      assert.equal((await stage.boundingBox()).y, stageTop, 'scrollIntoView keeps the stage pinned')
      assert.equal(await page.evaluate(() => window.scrollY), 0)
      assert.ok(await moduleScroll.evaluate((node) => node.scrollTop > 0), 'the module area can scroll to the row')
      await moduleScroll.evaluate((node) => { node.scrollTop = 0 })
      for (const [id, title] of [['feed', '事件'], ['compare', '对比'], ['roster', '名单'], ['hits', '命中'], ['kills', '击毁'], ['lanes', '按人时间线']]) {
        const area = page.locator(`[data-module="${id}"]`)
        assert.equal(await area.locator('.battle-module-handle svg').count(), 1)
        assert.equal(await area.locator('.battle-window-titlebar').evaluate((node) => getComputedStyle(node).userSelect), 'none')
        assert.equal(await area.getByRole('button', { name: '弹出 ' + title }).getAttribute('title'), '弹出')
        assert.equal(await area.getByRole('button', { name: '收起 ' + title }).getAttribute('title'), '收起')
      }
      const heightGrip = page.getByRole('separator', { name: '调整舞台高度' })
      assert.equal(await heightGrip.getAttribute('title'), '拖动调整高度，双击恢复')
      const startHeight = (await stage.boundingBox()).height
      await heightGrip.press('ArrowDown')
      assert.equal((await stage.boundingBox()).height, startHeight + 16)
      await heightGrip.dblclick()
      assert.equal((await stage.boundingBox()).height, startHeight)
      assert.equal(await page.locator('.eca-timeline-hint').count(), 1)
      assert.equal(await page.locator('details[open]:not(.replay-close-fights)').count(), 0)
      const canvasBeforeHint = await page.getByRole('region', { name: '回放', exact: true }).boundingBox()
      await page.getByRole('button', { name: '关闭时间轴提示' }).click()
      assert.deepEqual(await page.getByRole('region', { name: '回放', exact: true }).boundingBox(), canvasBeforeHint)
      await page.screenshot({ path: join(output, 'walk-stage-stable.png') })
      for (const area of ['.battle-replay', '.battle-timeline']) {
        await page.evaluate(() => window.getSelection().selectAllChildren(document.querySelector('[data-module="roster"] .roster-main')))
        assert.notEqual(await page.evaluate(() => window.getSelection().toString()), '')
        await page.locator(area).dispatchEvent('pointerdown', { pointerId: 1, button: 0, bubbles: true })
        assert.equal(await page.evaluate(() => window.getSelection().toString()), '', `pressing ${area} clears module text selection`)
      }
      await page.screenshot({ path: join(output, 'walk2-stage-selection-cleared.png') })
      const help = page.getByRole('button', { name: '时间轴用法' })
      await help.click()
      await page.getByRole('dialog', { name: '时间轴用法' }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog', { name: '时间轴用法' }).waitFor({ state: 'hidden' })
      await page.locator('.replay-noise summary').click()
      await page.getByRole('checkbox', { name: '隐藏无人机/战斗机伤害' }).check()
      await page.keyboard.press('Escape')
      assert.equal(await page.locator('.replay-noise[open]').count(), 0)
      await page.locator('.replay-noise summary').click()
      await page.getByRole('checkbox', { name: '隐藏无人机/战斗机伤害' }).uncheck()
      await page.keyboard.press('Escape')
      assert.match(await page.locator('[data-module="lanes"]').innerText(), /勾选飞行员/)

      await feed.getByRole('button', { name: '搜索事件' }).click()
      await feed.getByRole('searchbox', { name: '搜索事件' }).fill('no-match-smoke')
      await feed.getByText('没有匹配的事件 · 试试其他飞行员或武器。').waitFor()
      await feed.getByRole('button', { name: '搜索事件' }).click()
      const rosterModule = page.locator('[data-module="roster"]')
      await rosterModule.getByRole('button', { name: '搜索名单' }).click()
      await rosterModule.getByRole('searchbox', { name: '搜索名单' }).fill('no-match-smoke')
      await rosterModule.getByText('没有匹配的飞行员 · 试试其他名字或舰船。').waitFor()
      await rosterModule.getByRole('button', { name: '搜索名单' }).click()
      await hits.getByRole('button', { name: '整页查看命中' }).click()
      await hits.locator('.hit-analysis[data-expanded="true"]').waitFor()
      await page.keyboard.press('Escape')
      assert.equal(await hits.locator('.hit-analysis[data-expanded="true"]').count(), 0)

      async function dragHits(cancel) {
        await hitBar.scrollIntoViewIfNeeded()
        const from = await hitBar.boundingBox()
        const to = await left.boundingBox()
        await page.evaluate(() => window.getSelection().selectAllChildren(document.querySelector('.app-topbar-title')))
        await page.mouse.move(from.x + 10, from.y + 15)
        await page.mouse.down()
        await page.mouse.move(to.x + 70, from.y + 20, { steps: 12 })
        await page.locator('[data-module-drop]').waitFor()
        const ghost = page.locator('[data-module-ghost]')
        const firstGhost = await ghost.boundingBox()
        assert.ok(firstGhost && firstGhost.x < from.x - 150, 'ghost moves with the pointer')
        await page.mouse.move(to.x + 110, from.y + 20)
        assert.ok((await ghost.boundingBox()).x > firstGhost.x + 25, 'ghost follows later pointer movement')
        if (!cancel) await page.screenshot({ path: join(output, 'walk-drag-ghost.png') })
        assert.equal(await page.evaluate(() => window.getSelection().toString()), '')
        assert.equal(await page.locator('.app-topbar-title').evaluate((node) => getComputedStyle(node).userSelect), 'none')
        if (cancel) await page.keyboard.press('Escape')
        await page.mouse.up()
        assert.equal(await page.locator('[data-module-drop]').count(), 0)
        assert.equal(await ghost.count(), 0)
        assert.equal(await page.evaluate(() => document.body.classList.contains('battle-window-dragging')), false)
      }
      await dragHits(true)
      assert.equal(await hits.evaluate((node) => node.closest('[data-module-area]').dataset.moduleArea), '2')
      await dragHits(false)
      assert.equal(await hits.evaluate((node) => node.closest('[data-module-area]').dataset.moduleArea), '0')
      await hitBar.press('Alt+ArrowRight')
      assert.equal(await hits.evaluate((node) => node.closest('[data-module-area]').dataset.moduleArea), '1')
      await hits.getByRole('button', { name: '收起 命中' }).click()
      assert.equal(await hits.getAttribute('data-minimized'), 'true')
      await page.reload()
      await hits.waitFor()
      assert.equal(await hits.getAttribute('data-minimized'), 'true')
      assert.equal(await hits.evaluate((node) => node.closest('[data-module-area]').dataset.moduleArea), '1')
      const compareModule = page.locator('[data-module="compare"]')
      await compareModule.getByRole('button', { name: '弹出 对比' }).click()
      const layoutMenu = page.locator('.battle-module-controls > summary')
      assert.equal(await layoutMenu.textContent(), '布局')
      await layoutMenu.click()
      const toggles = page.getByRole('group', { name: '显示模块' })
      await toggles.getByText('拖动模块标题栏的 ⠿ 调整位置', { exact: true }).waitFor({ timeout: 1500 })
      const firstColumn = toggles.getByRole('group', { name: '第 1 列' })
      const secondColumn = toggles.getByRole('group', { name: '第 2 列' })
      assert.equal(await firstColumn.getByRole('checkbox', { name: '对比' }).getAttribute('aria-describedby') !== null, true)
      assert.match(await firstColumn.innerText(), /对比.*浮窗/s)
      assert.match(await secondColumn.innerText(), /命中.*收起.*名单.*击毁/s)
      await page.screenshot({ path: join(output, 'walk2-layout-groups.png') })
      await toggles.getByRole('checkbox', { name: '名单', exact: true }).uncheck()
      await page.locator('[data-module="roster"]').waitFor({ state: 'detached' })
      await toggles.getByRole('button', { name: '恢复默认布局' }).click()
      await toggles.waitFor({ state: 'hidden' })
      await page.getByText('已恢复默认布局', { exact: true }).waitFor()
      await page.screenshot({ path: join(output, 'walk-layout-reset.png') })
      assert.equal(await hits.getAttribute('data-minimized'), 'false')
      assert.equal(await hits.evaluate((node) => node.closest('[data-module-area]').dataset.moduleArea), '2')

      await feed.getByRole('button', { name: '弹出 事件' }).click()
      assert.equal(await feed.getAttribute('data-floating'), 'true')
      const handle = feed.getByRole('group', { name: '事件 标题栏' })
      const position = await feed.boundingBox()
      await handle.press('ArrowLeft')
      assert.equal((await feed.boundingBox()).x, position.x - 8)
      const floatGrip = await feed.locator('.battle-window-grip').boundingBox()
      await page.mouse.move(floatGrip.x + 8, floatGrip.y + 8)
      await page.mouse.down()
      await page.mouse.move(floatGrip.x + 34, floatGrip.y + 22, { steps: 6 })
      await page.mouse.up()
      assert.equal((await feed.boundingBox()).width, position.width + 26)
      await page.locator('.battle-module-scroll').evaluate((workspace) => { workspace.scrollTop = 410 })
      const floatingHandle = await handle.boundingBox()
      const target = await left.boundingBox()
      await page.mouse.move(floatingHandle.x + 16, floatingHandle.y + 16)
      await page.mouse.down()
      const moduleBounds = await moduleScroll.boundingBox()
      await page.mouse.move(target.x + 55, Math.max(target.y + 60, moduleBounds.y + 20), { steps: 8 })
      await page.locator('[data-module-drop]').waitFor()
      await page.mouse.up()
      assert.equal(await feed.getAttribute('data-floating'), 'false', 'dragging a floating module to an area docks it')
      await feed.getByRole('button', { name: '弹出 事件' }).click()
      const chart = page.getByRole('slider', { name: '回放时间' })
      await chart.press('Shift+ArrowRight')
      const rosterPilot = page.locator('.roster-main').filter({ hasText: pilot })
      await rosterPilot.click()
      const pilotRow = rosterPilot.locator('..')
      assert.equal(await rosterPilot.getAttribute('aria-pressed'), 'true')
      const drawer = page.getByRole('complementary', { name: '个人详情' })
      await drawer.waitFor()
      await pilotRow.getByRole('button', { name: `${pilot} 的操作` }).press('Enter')
      const rowMenu = page.getByRole('menu')
      const menuLabels = await rowMenu.getByRole('menuitem').allTextContents()
      await page.keyboard.press('Escape')
      await rowMenu.waitFor({ state: 'hidden' })
      await rosterPilot.click({ button: 'right', position: { x: 35, y: 10 } })
      assert.deepEqual(await rowMenu.getByRole('menuitem').allTextContents(), menuLabels)
      await page.keyboard.press('Escape')
      await page.keyboard.press('Escape')
      await drawer.waitFor({ state: 'hidden' })
      assert.equal(await rosterPilot.getAttribute('aria-pressed'), 'false')
      assert.equal(await page.locator('.replay-marker[data-selected="true"]').count(), 0)
      assert.equal(await feed.getAttribute('data-floating'), 'true')
      await chart.focus()
      await page.keyboard.press('Escape')
      assert.equal(await feed.getAttribute('data-floating'), 'false')
      await page.keyboard.press('Escape')
      assert.equal(await rosterPilot.getAttribute('aria-pressed'), 'false')
      console.log('Layout D: six modules, stage resize, hints, drag + Escape, no text selection, keyboard move, reload, reset, float resize and Escape stacking')

      await shot.page.getByRole('button', { name: '排边', exact: true }).click()
      const sides = shot.page.getByRole('dialog', { name: '排边' })
      const header = shot.page.getByRole('banner')
      const expectPageFixed = async () => {
        const scrollTop = await shot.page.evaluate(() => document.scrollingElement.scrollTop)
        const top = (await header.boundingBox())?.y
        assert.deepEqual({ scrollTop, top }, { scrollTop: 0, top: 0 }, 'sides popover keeps the battle page and top bar in place')
      }
      await expectPageFixed()
      const panelBox = await sides.boundingBox()
      assert.ok(panelBox && panelBox.y >= 48 && panelBox.y + panelBox.height <= height - 24,
        'sides popover fits below the top bar with a bottom margin')
      await sides.locator('.sides-col-body').first().hover()
      await shot.page.mouse.wheel(0, 1000)
      await expectPageFixed()
      await sides.getByRole('button', { name: '完成' }).click()
      console.log('Sides popover: 1280×800 page and top bar stay fixed')
      const compare = shot.page.getByRole('region', { name: '飞行员对比' })
      const comparisonPilot = compare.getByRole('button', { name: pilot, exact: true })
      const roster = shot.page.locator('.roster-main').filter({ hasText: pilot })
      await comparisonPilot.click()
      assert.equal(await roster.getAttribute('aria-pressed'), 'true')
      assert.equal(await comparisonPilot.locator('xpath=ancestor::tr').getAttribute('data-selected'), 'true')
      await shot.page.getByRole('complementary', { name: '个人详情' }).getByRole('button', { name: '关闭个人详情' }).click()
      await compare.getByRole('checkbox', { name: '并排对比 ' + pilot, exact: true }).check()
      const lane = shot.page.locator('[data-pilot-lane]').filter({ hasText: pilot })
      await lane.getByRole('button', { name: pilot, exact: true }).click()
      assert.equal(await lane.getAttribute('data-selected'), 'true')
      assert.equal(await roster.getAttribute('aria-pressed'), 'true')
      await shot.page.getByRole('complementary', { name: '个人详情' }).getByRole('button', { name: '关闭个人详情' }).click()
      await lane.getByRole('button', { name: pilot, exact: true }).click({ button: 'right' })
      await shot.page.getByRole('menuitem', { name: '移出时间轴对比' }).click()
      await lane.waitFor({ state: 'detached' })
      const person = shot.page.getByRole('complementary', { name: '个人详情' })
      async function auditSelection(source, clickable, row) {
        const key = await source.getAttribute('data-pilot-key')
        assert.ok(key)
        await clickable.click()
        await person.waitFor()
        assert.equal(await row.getAttribute('data-selected'), 'true')
        assert.equal(await page.locator(`.roster-row[data-pilot-key="${key}"] .roster-main`).getAttribute('aria-pressed'), 'true')
        await person.getByRole('button', { name: '关闭个人详情' }).click()
      }
      const participant = feed.locator('.feed-row .feed-participant[data-pilot-key^="char:"]').first()
      await auditSelection(participant, participant.locator('.feed-who'), participant.locator('xpath=ancestor::div[contains(@class,"feed-row")]'))
      const hitRow = hits.locator('.hit-table-scroll tbody [data-pilot-key^="char:"]').first()
      await auditSelection(hitRow, hitRow.locator('.hit-pilot-name'), hitRow)
      const kill = page.locator('[data-module="kills"] .kills-entry[data-pilot-key^="char:"]').first()
      await auditSelection(kill, kill.locator('.kills-row'), kill)
      const marker = await page.locator('.replay-pilot[tabindex="0"]').count()
      assert.ok(marker)
      const replayPilot = page.locator('.replay-pilot[tabindex="0"]').first()
      const replayNode = replayPilot.locator('..')
      const replayKey = await replayNode.getAttribute('data-pilot-key')
      await replayPilot.press('Enter')
      await person.waitFor()
      assert.equal(await page.locator(`.replay-marker[data-pilot-key="${replayKey}"]`).getAttribute('data-selected'), 'true')
      await page.locator('.replay-lock[data-positioned]').waitFor()
      await page.keyboard.press('Escape')
      await person.waitFor({ state: 'hidden' })
      assert.equal(await page.locator('.replay-lock').count(), 0, 'one Escape clears the replay selection bracket')
      assert.equal(await page.locator('.replay-tooltip').count(), 0, 'one Escape clears the selected pilot card')
      await page.screenshot({ path: join(output, 'walk-drawer-dismissed.png') })
      console.log('Pilot selection and menu: all seven views share selection, highlight, drawer, replay lock and pinning')

      const side = shot.page.getByRole('combobox', { name: '我方' })
      assert.equal(await side.getAttribute('aria-expanded'), 'false')
      // J125990 coverage after observed side inference and excluding catalog aliases.
      assert.match(await side.innerText(), /DeltaForce\.inc 等 41 人/)
      await side.press('ArrowDown')
      const options = shot.page.getByRole('listbox', { name: '我方' })
      const opponent = options.getByRole('option', { name: 'No Vacancies. 等 65 人', exact: true })
      const ally = options.getByRole('option', { name: 'DeltaForce.inc 等 41 人', exact: true })
      await opponent.waitFor()
      assert.equal(await ally.getAttribute('aria-selected'), 'true')
      const dotColor = (option) => option.locator('.app-side-picker-dot').evaluate((dot) => getComputedStyle(dot).backgroundColor)
      assert.notEqual(await dotColor(ally), await dotColor(opponent))
      await shot.page.screenshot({ path: join(output, '1280-side-picker.png'), animations: 'disabled' })
      await side.press('Home')
      await side.press('Enter')
      await shot.page.waitForURL(/ours=0/)
      assert.match(await side.innerText(), /No Vacancies\. 等 65 人/)
      await side.click()
      await ally.click()
      await shot.page.waitForURL(/ours=1/)
      assert.equal(await side.getAttribute('aria-expanded'), 'false')
      console.log('Side picker: real affiliation labels and swatches, keyboard and pointer selection')
    }
    if (width === 390 && theme === 'dark' && !motion) {
      const actions = shot.page.getByRole('button', { name: '更多战斗操作' })
      await actions.click()
      const side = shot.page.getByRole('combobox', { name: '我方' })
      await side.press('ArrowDown')
      const options = shot.page.getByRole('listbox', { name: '我方' })
      await options.getByRole('option', { name: 'No Vacancies. 等 65 人', exact: true }).waitFor()
      await shot.page.screenshot({ path: join(output, '390-side-picker.png'), animations: 'disabled' })
      await side.press('Escape')
      assert.equal(await side.getAttribute('aria-expanded'), 'false')
      assert.equal(await actions.getAttribute('aria-expanded'), 'true')
      await side.press('Escape')
      assert.equal(await actions.getAttribute('aria-expanded'), 'false')
    }
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
