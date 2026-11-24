// Usage: node scripts/rules-live.mjs [battle-url | --local]
import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { brId, fixture, launchChromium, startFixtureBattle } from './fixture-battle.mjs'

const production = `https://eve-combat-analytics.fabric-soul7.workers.dev/b/${brId}`
const args = process.argv.slice(2)
assert.ok(args.length <= 1 && (!args[0]?.startsWith('-') || args[0] === '--local'),
  'Usage: node scripts/rules-live.mjs [battle-url | --local]')
const local = args[0] === '--local'
const fixtureTime = Date.parse('2025-06-22T15:43:02.420Z')

async function seedLogs(origin) {
  const files = (await readdir(join(fixture, 'logs'))).filter((file) => file.endsWith('.gz')).sort()
  assert.equal(files.length, 17, 'expected the full real J125990 fixture')
  for (const file of files) {
    const body = gunzipSync(await readFile(join(fixture, 'logs', file)))
    const uploaded = await fetch(`${origin}/api/battles/${brId}/logs`, { method: 'POST', body })
    assert.ok(uploaded.ok, `${file}: ${uploaded.status} ${await uploaded.text()}`)
  }
}

const moduleAt = (page, id) => page.locator(`[data-module="${id}"]`)
const drawer = (page) => page.getByRole('complementary', { name: '个人详情' })
const range = (page) => page.locator('.eca-timeline-range button[title="取消选段"]')
const lock = (page) => page.locator('.replay-lock[data-positioned]')
const chart = (page) => page.getByRole('slider', { name: '回放时间' })
const column = (module) => module.evaluate((node) => node.closest('[data-module-area]').dataset.moduleArea)
const layout = (page) => page.locator('[data-module-area]').evaluateAll((areas) =>
  areas.map((area) => [...area.querySelectorAll('[data-module]')].map((node) => node.dataset.module)))

async function selectRosterPilot(page) {
  const key = await page.evaluate(() => {
    const keys = (selector) => new Set([...document.querySelectorAll(selector)].map((node) => node.dataset.pilotKey))
    const feed = keys('[data-module="feed"] .feed-row .feed-participant[data-pilot-key^="char:"]')
    const hits = keys('.hit-table-scroll tbody [data-pilot-key^="char:"]')
    const present = keys('.replay-marker[data-present]')
    return [...keys('[data-module="roster"] [data-pilot-key^="char:"]')]
      .find((id) => feed.has(id) && hits.has(id) && present.has(id))
  })
  assert.ok(key, 'expected a roster pilot visible in the current replay, events and hits')
  const row = moduleAt(page, 'roster').locator(`[data-pilot-key="${key}"]`)
  return { key, row, pilot: row.locator('.roster-main') }
}

async function dragHits(page, cancel) {
  const hits = moduleAt(page, 'hits')
  const grip = hits.locator('[title="拖动移动模块"]')
  await grip.hover()
  assert.equal(await grip.evaluate((node) => getComputedStyle(node).cursor), 'grab')
  const from = await grip.boundingBox()
  const original = await column(hits)
  const target = await page.locator(`[data-module-area="${original === '0' ? 1 : 0}"]`).boundingBox()
  const workspace = await page.locator('.battle-module-scroll').boundingBox()
  await page.locator('.app-topbar-title').evaluate((node) => window.getSelection().selectAllChildren(node))
  assert.notEqual(await page.evaluate(() => window.getSelection().toString()), '')
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  try {
    await page.mouse.move(target.x + 55, Math.max(workspace.y + 32, from.y + 8), { steps: 12 })
    await page.locator('[data-module-drop]').waitFor()
    assert.equal(await page.evaluate(() => window.getSelection().toString()), '')
    if (cancel) {
      await page.keyboard.press('Escape')
      await page.locator('[data-module-drop]').waitFor({ state: 'detached' })
    }
  } finally {
    await page.mouse.up()
  }
}

async function rule2(page) {
  const before = await layout(page)
  await dragHits(page, true)
  assert.deepEqual(await layout(page), before)
}

async function rule3(page) {
  await moduleAt(page, 'feed').locator('.feed-participant[data-pilot-key^="char:"]').first().waitFor()
  const { key, row, pilot } = await selectRosterPilot(page)
  const events = moduleAt(page, 'feed').locator('.feed-row').filter({
    has: page.locator(`.feed-participant[data-pilot-key="${key}"]`),
  })
  const hit = moduleAt(page, 'hits').locator(`.hit-table-scroll tbody [data-pilot-key="${key}"]`)
  const marker = page.locator(`.replay-marker[data-pilot-key="${key}"]`)
  await pilot.click()
  await drawer(page).waitFor()
  assert.notEqual(await row.getAttribute('data-selected'), null, 'roster row is highlighted')
  assert.equal(await pilot.getAttribute('aria-pressed'), 'true')
  const eventHighlights = await events.evaluateAll((rows) => rows.map((node) =>
    node.hasAttribute('data-selected') && getComputedStyle(node).boxShadow !== 'none'))
  assert.ok(eventHighlights.length && eventHighlights.every(Boolean), 'matching event rows are highlighted')
  assert.equal(await hit.getAttribute('data-selected'), 'true', 'hit row is highlighted')
  assert.equal(await marker.getAttribute('data-selected'), 'true', 'replay selects the same pilot')
  await lock(page).waitFor()

  async function assertCleared() {
    await drawer(page).waitFor({ state: 'hidden' })
    await lock(page).waitFor({ state: 'detached' })
    assert.equal(await pilot.getAttribute('aria-pressed'), 'false')
    assert.equal(await events.and(page.locator('[data-selected="true"]')).count(), 0)
    assert.notEqual(await hit.getAttribute('data-selected'), 'true')
  }
  await pilot.click()
  await assertCleared()
  await pilot.click()
  await drawer(page).waitFor()
  await page.keyboard.press('Escape')
  await assertCleared()
}

async function rule5(page) {
  const api = `/api/battles/${brId}`
  const { logs, identityMerges } = await (await page.request.get(api)).json()
  assert.equal(logs.length, 17, 'local battle contains all 17 logs')
  const unidentified = moduleAt(page, 'roster').locator('[data-pilot-key^="ship:"]').first()
  const from = await unidentified.getAttribute('data-pilot-key')
  const targetName = 'Blanchard2213'
  const to = 'char:2121605780'
  assert.ok(from && !identityMerges?.some((merge) => merge.from === from), 'unidentified row starts unmerged')
  await unidentified.locator('.roster-main').click({ button: 'right' })
  await page.getByRole('menuitem', { name: '这是谁…' }).click()
  const picker = page.getByRole('dialog', { name: /^这是谁 · / })
  const sourceName = (await picker.getAttribute('aria-label')).slice('这是谁 · '.length)
  await picker.getByRole('searchbox', { name: '搜索已知飞行员' }).fill(targetName)
  const notice = page.locator('[data-battle-toast]')
  const matchingMerge = (isMerged) => page.waitForFunction(async ({ api, from, to, isMerged }) => {
    const { identityMerges } = await (await fetch(api)).json()
    const target = identityMerges?.find((merge) => merge.from === from)?.to
    return target === (isMerged ? to : undefined)
  }, { api, from, to, isMerged }, { polling: 200, timeout: 12_000 })
  const source = moduleAt(page, 'roster').locator(`[data-pilot-key="${from}"]`)
  let restored = false
  try {
    await picker.locator('[data-result]').filter({ has: page.getByText(targetName, { exact: true }) }).click()
    await notice.getByText(`已合并 ${sourceName} → ${targetName}`, { exact: true }).waitFor()
    await notice.hover()
    await source.waitFor({ state: 'detached' })
    await matchingMerge(true)
    await notice.getByRole('button', { name: '撤销', exact: true }).click()
    await notice.getByText('已撤销', { exact: true }).waitFor()
    await matchingMerge(false)
    await source.waitFor()
    restored = true
  } finally {
    if (!restored) {
      const cleanup = await page.request.put(`${api}/identities`, { data: { from, to: null } })
      assert.ok(cleanup.ok(), `fixture cleanup failed: ${cleanup.status()}`)
    }
  }
}

async function rule6(page) {
  const feed = moduleAt(page, 'feed')
  await feed.getByRole('button', { name: '弹出 事件' }).click()
  await chart(page).press('Shift+ArrowRight')
  await range(page).waitFor()
  const roster = moduleAt(page, 'roster').locator('.roster-main').first()
  await roster.click()
  await drawer(page).waitFor()
  const menu = page.getByRole('menu')
  await roster.locator('..').getByRole('button', { name: /的操作$/ }).press('Enter')
  await menu.waitFor()

  await page.keyboard.press('Escape')
  await menu.waitFor({ state: 'hidden' })
  assert.ok(await drawer(page).isVisible(), 'first Escape only closes the menu')
  assert.equal(await feed.getAttribute('data-floating'), 'true')
  assert.ok(await range(page).isVisible())

  await page.keyboard.press('Escape')
  await drawer(page).waitFor({ state: 'hidden' })
  assert.equal(await roster.getAttribute('aria-pressed'), 'false', 'closing the drawer also clears its pilot')
  assert.equal(await feed.getAttribute('data-floating'), 'true', 'the float survives drawer dismissal')
  assert.ok(await range(page).isVisible())

  await chart(page).focus()
  await page.keyboard.press('Escape')
  assert.equal(await feed.getAttribute('data-floating'), 'false', 'the float docks before the range clears')
  assert.ok(await range(page).isVisible())
  await page.keyboard.press('Escape')
  await range(page).waitFor({ state: 'hidden' })
}

async function moveHits(page) {
  const hits = moduleAt(page, 'hits')
  const from = await column(hits)
  const to = from === '0' ? '1' : String(Number(from) - 1)
  const bar = hits.getByRole('group', { name: '命中 标题栏' })
  await bar.focus()
  assert.ok(await bar.evaluate((node) => document.activeElement === node), 'module title bar takes focus')
  await page.keyboard.press(from === '0' ? 'Alt+ArrowRight' : 'Alt+ArrowLeft')
  assert.equal(await column(hits), to, 'Alt+Arrow moves the module to the adjacent column')
  return bar
}

async function rule8(page) {
  const before = await layout(page)
  await dragHits(page, false)
  const moved = await layout(page)
  assert.notDeepEqual(moved, before)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await moduleAt(page, 'hits').waitFor()
  assert.deepEqual(await layout(page), moved, 'module positions survive reload')
  await page.locator('.battle-module-controls > summary').click()
  await page.getByRole('button', { name: '恢复默认布局' }).click()
  assert.deepEqual(await layout(page), before, 'reset restores the default module positions and order')
}

async function rule9(page) {
  const bar = await moveHits(page)
  assert.ok(await bar.evaluate((node) => document.activeElement === node), 'focus follows the moved module')
}

let server
let browser
try {
  if (local) {
    server = await startFixtureBattle()
    await seedLogs(server.origin)
  }
  const url = new URL(local ? `${server.origin}/b/${brId}` : args[0] ?? production)
  if (url.pathname === `/b/${brId}` && !url.searchParams.has('t')) url.searchParams.set('t', fixtureTime)
  console.log(`Rules target: ${url.href}`)
  browser = await launchChromium()
  const rules = [[2, rule2], [3, rule3], [5, rule5], [6, rule6], [8, rule8], [9, rule9]]
  for (const [number, run] of rules) {
    if (number === 5 && !local) {
      console.log('SKIP rule 5 — the undo toast requires a shared edit; use --local')
      continue
    }
    const context = await browser.newContext({ baseURL: url.origin, viewport: { width: 1630, height: 940 }, serviceWorkers: 'block' })
    const blocked = []
    try {
      await context.route('**/*', (route) => {
        const request = route.request()
        if (local && new URL(request.url()).origin !== url.origin) return route.abort()
        if (!local && !['GET', 'HEAD'].includes(request.method())) {
          blocked.push(`${request.method()} ${request.url()}`)
          return route.abort()
        }
        return route.continue()
      })
      const page = await context.newPage()
      page.setDefaultTimeout(12_000)
      await page.goto(url.href, { waitUntil: 'domcontentloaded' })
      await moduleAt(page, 'hits').waitFor()
      await page.locator('.replay-marker[data-present]').first().waitFor({ state: 'attached' })
      await run(page)
      assert.deepEqual(blocked, [], 'read-only check attempted to write')
      console.log(`PASS rule ${number}`)
    } catch (error) {
      console.error(`FAIL rule ${number} — ${error.message}`)
      process.exitCode = 1
    } finally {
      await context.close()
    }
  }
} finally {
  try {
    await browser?.close()
  } finally {
    await server?.close()
  }
}
