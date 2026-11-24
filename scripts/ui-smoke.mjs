// Verify the real Vite UI, Worker, SQLite Durable Object and WebSocket on loopback.
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { brId, fixture, launchChromium, root, startFixtureBattle } from './fixture-battle.mjs'

const output = join(root, 'build/ui-smoke')
const route = `/b/${brId}`
const pilot = 'Blanchard2213'
const logFile = '20250622_134516_2121605780.txt'

await mkdir(output, { recursive: true })
const server = await startFixtureBattle()
const { origin } = server
let browser
try {
  browser = await launchChromium()
  async function open(width, height, colorScheme, reducedMotion = 'no-preference', query = '', hasTouch = false) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme, reducedMotion, hasTouch, serviceWorkers: 'block' })
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

  async function auditTagAndKillStyles() {
    const { page, context } = await open(1630, 940, 'dark')
    try {
      const killRows = page.locator('[data-module="kills"] .kills-row')
      await killRows.first().waitFor()
      const kills = await killRows.evaluateAll((rows) => rows.slice(0, 3).map((row) => {
        const portrait = row.querySelector('.app-portrait')
        const overlay = row.querySelector('.kills-type')
        const box = (element) => element.getBoundingClientRect()
        return {
          row: box(row).height, portrait: [box(portrait).width, box(portrait).height],
          overlay: [box(overlay).width, box(overlay).height],
          radius: getComputedStyle(portrait).borderRadius,
          expectedRadius: getComputedStyle(portrait).getPropertyValue('--radius-ctl').trim(),
        }
      }))
      await page.goto(origin + '/_gallery#roster', { waitUntil: 'domcontentloaded' })
      const tag = (kind) => page.locator(`#roster .roster-bare .app-tag[data-kind="${kind}"]`).first()
      const colors = (node) => {
        const style = getComputedStyle(node)
        return { border: style.borderTopColor, text: style.color }
      }
      const manual = await tag('manual').evaluate(colors)
      const log = await tag('log').evaluate(colors)
      assert.deepEqual(
        { log, kills: kills.map(({ expectedRadius, ...sizes }) => sizes) },
        { log: manual, kills: kills.map(({ expectedRadius }) =>
          ({ row: 32, portrait: [28, 28], overlay: [16, 16], radius: expectedRadius })) },
        'log and manual tags use the same neutral colors, and kill rows fit their specified portrait and overlay',
      )
      console.log('Roster tags: log and manual colors match. Kill list: 32px rows, 28px portraits, 16px overlays.')
    } finally {
      await context.close()
    }
  }

  await auditTagAndKillStyles()

  async function checkReplayCadence(page) {
    const start = page.url()
    const controls = page.getByRole('group', { name: '回放控制' })
    let best = 0
    for (let sample = 0; sample < 3; sample++) {
      if (sample > 0) await page.goto(start)
      await page.locator('.replay-marker[data-present] .replay-pilot').first().waitFor()
      await page.evaluate(() => document.fonts.ready)
      await controls.getByRole('button', { name: '1×', exact: true }).click()
      await controls.getByRole('button', { name: '2×', exact: true }).click()
      await controls.getByRole('button', { name: '4×', exact: true }).waitFor()
      await page.evaluate(() => {
        const ctx = document.querySelector('.replay-layer').getContext('2d')
        const clear = ctx.clearRect
        window.replayPaintTimes = []
        ctx.clearRect = function (...bounds) {
          window.replayPaintTimes.push(performance.now())
          return clear.apply(this, bounds)
        }
      })
      await controls.getByRole('button', { name: '播放', exact: true }).click()
      const fps = await page.evaluate(async () => {
        await new Promise((resolve) => setTimeout(resolve, 6_000))
        const times = window.replayPaintTimes
        const frames = times.filter((time) => time >= times[0] + 750)
        return frames.length < 2 ? 0 : 1000 * (frames.length - 1) / (frames.at(-1) - frames[0])
      })
      await controls.getByRole('button', { name: '暂停', exact: true }).click()
      best = Math.max(best, fps)
      console.log(`Full workspace at 4×, sample ${sample + 1}: ${fps.toFixed(1)} painted fps`)
      if (best >= 38) break
    }
    assert.ok(best >= 38, `full workspace at 4× paints at least 38 fps, measured ${best.toFixed(1)}`)
  }

  async function assertReplayNames(page, size, zoom) {
    const stage = page.locator('.replay-stage')
    await stage.locator('.replay-marker[data-present] .replay-pilot[data-log="true"]').first().waitFor()
    if (size) {
      await stage.evaluate((node, [width, height]) => {
        const replay = node.closest('.battle-replay')
        replay.closest('.battle-layout').style.gridTemplateRows = `${height}px auto auto`
        replay.style.width = node.style.width = `${width}px`
        replay.style.height = node.style.height = `${height}px`
      }, size)
      await page.waitForFunction(([width, height]) =>
        Boolean(document.querySelector(`.replay-layer[width="${width}"][height="${height}"]`)), size)
    }
    if (zoom) {
      await stage.getByRole('button', { name: '适应全部', exact: true }).click()
      await stage.evaluate((node, scale) => {
        const rect = node.getBoundingClientRect()
        node.dispatchEvent(new WheelEvent('wheel', {
          clientX: rect.left + node.clientWidth / 2,
          clientY: rect.top + node.clientHeight / 2,
          deltaY: -Math.log(scale) / 0.002,
          bubbles: true, cancelable: true,
        }))
      }, zoom)
      await stage.locator('.replay-zoom').getByText(`${Math.round(zoom * 100)}%`, { exact: true }).waitFor()
    }
    const result = await stage.evaluate(async (node, zoom) => {
      await document.fonts.ready
      // The zoom moves ships, then the automatic fight window, then its label obstacles.
      for (let frame = 0; frame < (zoom ? 5 : 2); frame++) await new Promise(requestAnimationFrame)
      const markers = [...node.querySelectorAll('.replay-marker[data-present]')]
      const labels = [...node.querySelectorAll('[data-pilot-label][data-positioned]')]
      const boxes = labels.map((label) => label.getBoundingClientRect())
      const touching = boxes.flatMap((box, index) => boxes.slice(0, index).flatMap((other, before) =>
        box.right + 5.9 > other.left && other.right + 5.9 > box.left
          && box.bottom + 1.9 > other.top && other.bottom + 1.9 > box.top
          ? [[labels[index].textContent, labels[before].textContent]] : []))
      const visible = new Map(labels.map((label, index) => [label.dataset.pilotLabel, boxes[index]]))
      const view = node.getBoundingClientRect()
      const pilots = markers.flatMap((marker) => {
        const pilot = marker.querySelector('.replay-pilot')
        const ring = pilot.getBoundingClientRect()
        if (zoom && (ring.right <= view.left || ring.left >= view.right || ring.bottom <= view.top || ring.top >= view.bottom)) return []
        return [{ marker, pilot, ring }]
      })
      const names = pilots.flatMap(({ marker, pilot, ring }) => {
        const box = visible.get(marker.dataset.pilotKey)
        const name = pilot.getAttribute('aria-label')
        if (!box) return zoom || pilot.dataset.log === 'true' ? [name] : []
        const x = ring.left + ring.width / 2
        const y = ring.top + ring.height / 2
        const distance = Math.hypot(Math.max(0, box.left - x, x - box.right), Math.max(0, box.top - y, y - box.bottom))
        const ringRadius = zoom ? ring.width / 2 : 0
        return distance > 40.1 + ringRadius ? [name] : []
      })

      return { touching, names, inView: pilots.length, uploaders: markers.filter((marker) => marker.querySelector('[data-log="true"]')).length }
    }, zoom ?? null)
    assert.ok(result.uploaders >= 17, 'the label check uses the complete real fight')
    assert.deepEqual(result.touching, [], 'replay names have 6 px horizontal or 2 px vertical clearance')
    if (zoom) {
      assert.ok(result.inView > 0, `the real fight has visible pilots at ${zoom}×`)
      assert.deepEqual(result.names, [], `each in-view pilot has a visible label within 40 px at ${zoom}×`)
      console.log(`Replay names: all ${result.inView} in-view pilots labeled within 40 px at ${zoom}×`)
    }
    if (size || zoom) {
      if (size) assert.deepEqual(result.names, [], `each uploader is labeled within 40 px at ${size.join(' × ')} and all labels stay near their ships`)
      await assertClearPilotLabels(page)
    }
  }

  async function assertClearPilotLabels(page) {
    const covered = await page.locator('.replay-stage').evaluate(async (stage) => {
      // Let observer-driven placement run after an overlay opens or moves.
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const obstacles = [...stage.querySelectorAll('.replay-control-trigger, .replay-noise summary, .replay-zoom')]
      for (const trigger of [...obstacles]) {
        const panel = document.getElementById(trigger.getAttribute('aria-controls') ?? '')
        if (panel) obstacles.push(panel)
      }
      const bounds = obstacles.map((node) => node.getBoundingClientRect())
      return [...stage.querySelectorAll('.replay-pilot-label[data-positioned]')].filter((label) => {
        const rect = label.getBoundingClientRect()
        return bounds.some((box) => rect.right > box.left && rect.left < box.right
          && rect.bottom > box.top && rect.top < box.bottom)
      }).map((label) => label.textContent)
    })
    assert.deepEqual(covered, [], 'pilot names avoid replay buttons and open overlay windows')
  }

  async function checkReplayOverlays(page, width, height) {
    const stage = page.getByRole('region', { name: '回放舞台' })
    const replay = page.getByRole('region', { name: '回放', exact: true })
    const trigger = page.getByRole('button', { name: '交互图例', exact: true })
    const legend = page.getByRole('region', { name: '交互图例', exact: true })
    const lastItem = legend.getByText('未命中', { exact: true })
    const stageBox = await stage.boundingBox()
    const timeline = stage.getByRole('region', { name: '时间轴', exact: true })
    async function checkTimeline() {
      assert.ok((await timeline.boundingBox()).height >= 150, 'the timeline reserves room for its plot, controls and axis')
      const { damageHeight, intersections } = await timeline.locator('[data-timeline-chart]').evaluate((node) => {
        const labels = [...node.querySelectorAll('.eca-timeline-label')].map((label) => ({
          name: label.textContent, box: label.getBoundingClientRect(),
        })).sort((a, b) => a.box.top - b.box.top)
        const lane = node.querySelector('[data-lane="damage"]')
        return {
          damageHeight: Number(lane.getAttribute('data-lane-height')) * Math.abs(lane.getScreenCTM().d),
          intersections: labels.slice(1).flatMap(({ name, box }, index) =>
            box.top < labels[index].box.bottom ? [[labels[index].name, name]] : []),
        }
      })
      assert.ok(damageHeight >= 90, 'the damage curve lane is at least 90 CSS pixels tall')
      assert.deepEqual(intersections, [], 'timeline lane labels do not overlap')
    }
    await checkTimeline()
    const canvasHeight = (await replay.boundingBox()).height
    const columnWidths = await page.locator('[data-module-area]').evaluateAll((columns) =>
      columns.map((column) => column.getBoundingClientRect().width))
    const fights = page.getByRole('region', { name: '此刻交火', exact: true })
    const layoutIssues = []
    if (Math.abs(stageBox.height / height - 0.62) > 0.005) layoutIssues.push(`stage is ${stageBox.height}/${height}px, expected 62%`)
    if (Math.abs(columnWidths[0] / columnWidths[1] - 1.45) > 0.005 || Math.abs(columnWidths[2] / columnWidths[1] - 1) > 0.005) {
      layoutIssues.push(`module columns are ${columnWidths.join(':')}, expected 1.45:1:1`)
    }
    assert.deepEqual(layoutIssues, [], `default layout at ${width}×${height}`)
    assert.ok((await page.locator('.battle-module-scroll').boundingBox()).height >= 220, 'modules retain at least 220 px by default')
    const grip = stage.getByRole('separator', { name: '调整舞台高度' })
    await grip.press('ArrowUp')
    assert.equal((await replay.boundingBox()).height, canvasHeight - 16)
    await checkTimeline()
    await grip.dblclick()
    assert.equal((await replay.boundingBox()).height, canvasHeight)
    for (const [edge, y, expected] of [['min', 60, 300], ['max', height - 2, Math.floor(height * 0.75)]]) {
      const box = await grip.boundingBox()
      const x = box.x + box.width / 2
      await page.mouse.move(x, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(x, y, { steps: 8 })
      await page.mouse.up()
      assert.equal((await stage.boundingBox()).height, expected, `the stage drag reaches its ${edge} height`)
      assert.equal(Number(await grip.getAttribute(`aria-value${edge}`)), expected, 'the grip reports the whole stage height')
      await checkTimeline()
    }
    await grip.dblclick()
    assert.equal((await stage.boundingBox()).height, stageBox.height, 'double-click restores the default stage height')
    const extraLayers = ['我方维修', '点人', '击毁用舰船图标'].map((name) => timeline.getByRole('button', { name, exact: true }))
    for (const layer of extraLayers) await layer.click()
    await checkTimeline()
    await page.waitForFunction(() => document.querySelector('.battle-module-scroll').getBoundingClientRect().height >= 220)
    for (const layer of extraLayers) await layer.click()
    await page.waitForFunction((expected) =>
      document.querySelector('.battle-stage .battle-replay').getBoundingClientRect().height === expected, canvasHeight)
    await page.screenshot({ path: join(output, `readable-timeline-${width}x${height}-dark.png`) })
    assert.ok(await page.locator('.eca-timeline-bar .eca-timeline-hint').isVisible(), 'the timeline hint shares the controls row')
    await trigger.click()
    await lastItem.waitFor()
    async function checkLegend() {
      const box = await legend.boundingBox()
      const last = await lastItem.boundingBox()
      assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= height)
      assert.ok(last.y >= box.y && last.y + last.height <= box.y + box.height, 'the final legend item fits in the window')
      assert.equal(await lastItem.evaluate((node) => {
        const rect = node.getBoundingClientRect()
        return node.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      }), true, 'the last legend item is visible and can be hit')
      return box
    }
    const initial = await checkLegend()
    const pills = replay.locator('.replay-header-actions')
    const pillRow = await pills.boundingBox()
    const legendGap = initial.y - (pillRow.y + pillRow.height)
    assert.ok(legendGap >= 7.5 && legendGap <= 16,
      `the legend opens just below the entire row of replay controls, gap ${legendGap}px`)
    assert.equal(await pills.locator('button, summary').evaluateAll((buttons) => buttons.every((button) => {
      const rect = button.getBoundingClientRect()
      return button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    })), true, 'all three replay controls are reachable with the legend open')
    console.log(`Workspace ${width}×${height}: stage ${stageBox.height}px, columns ${columnWidths.map(Math.round).join(':')}px, legend gap ${legendGap}px`)
    await assertClearPilotLabels(page)
    await page.screenshot({ path: join(output, `replay-overlays-${width}x${height}-dark.png`) })
    const dragGrip = await legend.locator('.battle-module-handle').boundingBox()
    await page.mouse.move(dragGrip.x + dragGrip.width / 2, dragGrip.y + dragGrip.height / 2)
    await page.mouse.down()
    await page.mouse.move(dragGrip.x + 330, dragGrip.y + 300, { steps: 5 })
    await page.mouse.up()
    const moved = await checkLegend()
    await assertClearPilotLabels(page)
    assert.ok(moved.x > initial.x && moved.y > initial.y && moved.y + moved.height > stageBox.y + stageBox.height,
      'the legend can move past the stage into the module area')
    await legend.getByRole('button', { name: '收起 交互图例' }).click()
    assert.equal(await lastItem.isVisible(), false)
    await page.reload()
    await legend.getByRole('button', { name: '还原 交互图例' }).click()
    assert.deepEqual(await checkLegend(), moved, 'open, collapsed and position state survive reload')
    await page.screenshot({ path: join(output, `replay-overlays-dragged-${width}x${height}-dark.png`) })
    const resize = await legend.locator('.battle-window-grip').boundingBox()
    await page.mouse.move(resize.x + 8, resize.y + 8)
    await page.mouse.down()
    await page.mouse.move(resize.x + 8, resize.y - 200, { steps: 5 })
    await page.mouse.up()
    const legendBody = legend.locator('.battle-window-body')
    assert.ok(await legendBody.evaluate((node) => node.scrollHeight > node.clientHeight), 'small legend windows scroll internally')
    await lastItem.evaluate((node) => node.scrollIntoView({ block: 'nearest' }))
    await checkLegend()
    await legend.getByRole('button', { name: '关闭 交互图例' }).click()
    assert.equal(await trigger.getAttribute('aria-expanded'), 'false')

    await fights.getByRole('button', { name: '关闭 此刻交火' }).click()
    assert.equal(await fights.count(), 0)
    await page.getByRole('button', { name: '此刻交火', exact: true }).click()
    await fights.waitFor()

    // Put the anchor near the viewport bottom to exercise flipping and escape the stage clip.
    const noise = page.locator('.replay-noise summary')
    const panel = page.locator('.replay-noise-popover')
    await noise.evaluate((node) => { node.style.transform = `translateY(${window.innerHeight - 60 - node.getBoundingClientRect().top}px)` })
    await noise.evaluate((node) => node.click())
    await panel.waitFor()
    const anchor = await noise.boundingBox()
    const filter = await panel.boundingBox()
    assert.ok(filter.x >= 0 && filter.x + filter.width <= width && filter.y >= 0 && filter.y + filter.height <= anchor.y)
    const lastFilter = panel.getByRole('checkbox', { name: '隐藏未命中' })
    assert.equal(await lastFilter.evaluate((node) => {
      const rect = node.getBoundingClientRect()
      return document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2) === node
    }), true, 'the last filter is reachable outside the stage')
    await page.keyboard.press('Escape')
    await panel.waitFor({ state: 'hidden' })
    await noise.evaluate((node) => { node.style.transform = '' })
    // This is a fresh context. Restore the defaults before the remaining layout smoke steps.
    await page.locator('.battle-module-controls > summary').click()
    await page.getByRole('button', { name: '恢复默认布局' }).click()
  }

  async function checkFightsAndChrome(page, width) {
    const replay = page.locator('.replay-stage')
    const fights = page.getByRole('region', { name: '此刻交火', exact: true })
    const replayBox = await replay.boundingBox()
    const defaults = await fights.boundingBox()
    const small = replayBox.width < 1200
    const issues = []
    if ((await fights.getAttribute('data-minimized')) !== String(small)) issues.push('fights collapse below 1200px of replay width')
    if (defaults.width < 300) issues.push(`fights width was ${defaults.width}px, expected at least 300px`)
    const pills = await replay.locator('.replay-header-actions').boundingBox()
    const pilots = await replay.locator('.replay-marker[data-present] .replay-pilot').evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().toJSON()))
    if (pilots.some((node) => node.top < pills.y + pills.height - 0.5)) issues.push('live pilot markers enter the replay control inset')
    if (width === 900) {
      const title = await page.locator('.app-topbar-title').evaluate((node) => ({
        width: node.clientWidth, textWidth: node.querySelector('.app-topbar-short-title').getBoundingClientRect().width,
      }))
      if (title.width < 179 || title.textWidth > title.width) issues.push(`tablet title is clipped: ${JSON.stringify(title)}`)
      const header = await page.locator('.app-topbar').evaluate((node) => ({
        width: node.clientWidth, contentWidth: node.scrollWidth,
      }))
      if (header.contentWidth > header.width + 1) issues.push(`tablet battle actions overflow: ${JSON.stringify(header)}`)
      const side = await page.getByRole('combobox', { name: '我方' }).evaluate((button) => {
        const label = button.querySelector('.app-side-picker-compact-label')
        const name = label?.querySelector('.app-side-picker-compact-name')
        const dot = button.querySelector('.app-side-picker-dot')
        return { width: button.clientWidth, label: label?.textContent, nameWidth: name?.clientWidth, dot: dot?.getBoundingClientRect().width }
      })
      if (side.width < 118 || side.dot !== 8 || !/^DeltaForce… 等 \d+ 人$/.test(side.label ?? '') || side.nameWidth < 48) {
        issues.push(`tablet side picker has no readable compact affiliation: ${JSON.stringify(side)}`)
      }
    }
    assert.deepEqual(issues, [], `replay and top bar at ${width}px`)
    assert.ok(defaults.x >= replayBox.x && defaults.y >= replayBox.y
      && defaults.x + defaults.width <= replayBox.x + replayBox.width
      && defaults.y + defaults.height <= replayBox.y + replayBox.height, 'the automatic fight window stays inside the replay')
    if (width >= 1280) {
      async function assertNoCoveredShips() {
        const covered = await fights.evaluate(async (panel) => {
          await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)))
          const box = panel.getBoundingClientRect()
          return [...document.querySelectorAll('.replay-marker[data-present] .replay-pilot')].filter((pilot) => {
            const rect = pilot.getBoundingClientRect()
            const x = rect.x + rect.width / 2, y = rect.y + rect.height / 2
            return box.left <= x && x <= box.right && box.top <= y && y <= box.bottom
          }).map((pilot) => pilot.getAttribute('aria-label'))
        })
        assert.deepEqual(covered, [], `no pilot center sits under current fights at ${width}px`)
      }
      await assertNoCoveredShips()
      await fights.getByRole('button', { name: '关闭 此刻交火' }).click()
      await replay.getByRole('button', { name: '此刻交火', exact: true }).click()
      await fights.waitFor()
      await assertNoCoveredShips()
      const grip = page.getByRole('separator', { name: '调整舞台高度' })
      await grip.press('ArrowUp')
      await assertNoCoveredShips()
      await grip.dblclick()
    }
    await page.screenshot({ path: join(output, `final-review-workspace-${width}-dark.png`) })
    if (small) await fights.getByRole('button', { name: '还原 此刻交火' }).click()
    const widths = await fights.locator('thead th').evaluateAll((nodes) =>
      nodes.map((node) => node.getBoundingClientRect().width))
    assert.ok(widths[0] >= 90 && widths[1] >= 90, 'both participant columns have at least 90px')
    assert.equal(await fights.locator('.battle-window-heading, .battle-window-subtitle').evaluateAll((nodes) =>
      nodes.every((node) => node.scrollWidth <= node.clientWidth + 1)), true, 'the title and time subtitle fit')
    if (width === 900) await page.screenshot({ path: join(output, 'final-review-fights-open-900-dark.png') })
    if (small) await fights.getByRole('button', { name: '收起 此刻交火' }).click()

    if (width === 1630) {
      async function assertAboveFights(popup, label) {
        const box = await popup.boundingBox()
        const old = await fights.evaluate((window, { x, y }) => {
          const previous = { left: window.style.left, top: window.style.top }
          window.style.left = `${x}px`
          window.style.top = `${y}px`
          return previous
        }, { x: box.x + 1, y: box.y + 1 })
        try {
          assert.equal(await popup.evaluate((node) => {
            const rect = node.getBoundingClientRect()
            return node.contains(document.elementFromPoint(rect.x + 8, rect.y + 8))
          }), true, `${label} top-left stays interactive above current fights`)
        } finally {
          await fights.evaluate((window, previous) => Object.assign(window.style, previous), old)
        }
      }
      await page.getByRole('button', { name: '时间轴用法' }).click()
      const help = page.getByRole('dialog', { name: '时间轴使用说明' })
      await assertAboveFights(help, 'timeline help')
      await help.getByRole('heading', { name: '时间轴使用说明' }).waitFor()
      await help.getByRole('button', { name: '关闭时间轴使用说明' }).click()
      await help.waitFor({ state: 'hidden' })
      await page.getByRole('button', { name: '时间轴用法' }).click()
      await page.keyboard.press('Escape')
      await help.waitFor({ state: 'hidden' })
      await replay.locator('.replay-noise summary').click()
      const damage = page.locator('.replay-noise-popover')
      await damage.waitFor()
      await assertAboveFights(damage, 'damage filters')
      await page.keyboard.press('Escape')
      await damage.waitFor({ state: 'hidden' })
      await replay.getByRole('button', { name: '交互图例', exact: true }).click()
      const legend = page.getByRole('region', { name: '交互图例', exact: true })
      const grip = page.getByRole('separator', { name: '调整舞台高度' })
      await legend.waitFor()
      const compare = page.getByRole('region', { name: '飞行员对比' })
      await compare.getByRole('button', { name: '整页', exact: true }).click()
      assert.equal(await legend.isVisible(), false)
      assert.equal(await fights.isVisible(), false)
      assert.equal(await grip.isVisible(), false)
      await page.screenshot({ path: join(output, 'final-review-compare-full-1630-dark.png') })
      await compare.getByRole('button', { name: '收起', exact: true }).click()
      await legend.waitFor()
      await fights.waitFor()
      await grip.waitFor()
      await legend.getByRole('button', { name: '关闭 交互图例' }).click()
      const layout = page.locator('.battle-module-controls > summary')
      await layout.click()
      const resetLayout = page.getByRole('button', { name: '恢复默认布局' })
      assert.equal(await resetLayout.getAttribute('data-variant'), 'ghost')
      await assertAboveFights(page.getByRole('group', { name: '显示模块' }), 'layout menu')
      await page.screenshot({ path: join(output, 'final-review-layout-menu-1630-dark.png') })
      await layout.click()
      await page.locator('[data-module="roster"] .roster-main').first().click({ button: 'right' })
      const rowMenu = page.getByRole('menu')
      await rowMenu.waitFor()
      await assertAboveFights(rowMenu, 'pilot row menu')
      await page.keyboard.press('Escape')
      await rowMenu.waitFor({ state: 'hidden' })
    }
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
  const noisePanel = a.page.locator('.replay-noise-popover')
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
  const feedMode = phonePage.getByRole('button', { name: '逐条' })
  assert.equal(await feedMode.getAttribute('aria-pressed'), 'true', 'phone feed shows each event by default')
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
  const fullBattle = await (await fetch(`${origin}/api/battles/${brId}/analysis`)).json()
  assert.equal(fullBattle.coverage.find(({ side }) => side === 1)?.known, 41, 'J125990 has 41 known pilots on the uploaders’ side')
  console.log('J125990 battle-time affiliations: 我方 41 with all 17 uploads')
  const density = []
  const failures = []
  for (const width of [1280, 1630]) {
    const { context, page } = await open(width, 940, 'dark', 'no-preference', '?t=1750606982000')
    const hits = page.locator('[data-module="hits"] .hit-table-scroll')
    const compare = page.locator('[data-module="compare"]')
    const tableHeights = (table) => table.locator('thead tr, tbody tr[data-pilot-key]').evaluateAll((rows) =>
      rows.map((row) => row.getBoundingClientRect().height).filter((height) => height > 0))
    try {
      await hits.locator('tbody tr[data-pilot-key]').first().waitFor()
      const kohera = hits.getByRole('button', { name: 'Kohera Hakomairos', exact: true })
      assert.match(await kohera.getAttribute('title'), /Kohera Hakomairos.*据我方日志.*无命中质量/)
      await page.evaluate(() => document.fonts.ready)
      for (const [name, selector] of [
        ['名单', '[data-module="roster"] .roster-row'],
        ['事件', '[data-module="feed"] .feed-row'],
        ['命中', '[data-module="hits"] .hit-table-scroll tbody tr[data-pilot-key]'],
      ]) {
        const pitch = await page.locator(selector).evaluateAll((rows, selector) => rows.flatMap((row) => {
          const next = row.nextElementSibling
          return next?.matches(selector) ? [next.getBoundingClientRect().top - row.getBoundingClientRect().top] : []
        }), selector)
        const pitches = [...new Set(pitch)]
        density.push({ width, table: name, pitches })
        if (!pitch.length || pitches.some((px) => px !== 24)) failures.push({ width, table: name, pitches })
      }

      const roster = page.locator('[data-module="roster"]')
      const firstUnlogged = roster.locator('.roster-row[data-nolog][data-pilot-key^="char:"]').first()
      const sticky = await firstUnlogged.evaluate(async (row) => {
        const list = row.closest('.battle-window-body')
        const top = list.getBoundingClientRect().top + list.clientTop
        list.scrollTop += row.getBoundingClientRect().top - top + 72 + 7
        await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const header = [...list.querySelectorAll('.roster-head')].find((heading) =>
          Math.abs(heading.getBoundingClientRect().top - top) <= 1)
        const edge = header?.getBoundingClientRect().bottom ?? top
        const peeking = [...list.querySelectorAll('.roster-row')].some((element) => {
          const bounds = element.getBoundingClientRect()
          return bounds.top < edge && edge < bounds.bottom && Number(getComputedStyle(element).opacity) > 0
        })
        const result = { text: header?.textContent ?? '', peeking }
        list.scrollTop = 0
        return result
      })
      if (!/我方.*无日志/.test(sticky.text) || sticky.peeking) failures.push({ width, roster: sticky })
      const hitHeights = await tableHeights(hits)
      density.push({ width, table: '命中 module', max: Math.max(...hitHeights) })

      await compare.getByRole('button', { name: '整页查看对比', exact: true }).click()
      const fullCompare = compare.locator('.u7-compare[data-expanded="true"] .u7-compare-scroll')
      await fullCompare.locator('tbody tr[data-pilot-key]').first().waitFor()
      assert.ok(await fullCompare.locator('tbody .u7-observed').count(), 'J125990 includes observed rows')
      assert.ok(await fullCompare.locator('tbody [title^="据我方日志 · "]').count(), 'observed sample counts have a tooltip')
      const hasQualityHeader = await fullCompare.getByRole('columnheader', { name: '命中质量', exact: true }).count() === 1
      if (!hasQualityHeader) failures.push({ width, table: 'full-page 对比', missing: '命中质量' })
      else {
        const headerFits = await fullCompare.getByRole('columnheader', { name: '命中质量', exact: true }).evaluate((cell) =>
          cell.getBoundingClientRect().right <= cell.closest('.u7-compare-scroll').getBoundingClientRect().right)
        if (!headerFits) failures.push({ width, table: 'full-page 对比', clipped: '命中质量' })
      }
      const remaining = await fullCompare.evaluate((el) => ({
        below: window.innerHeight - el.getBoundingClientRect().bottom,
        pad: parseFloat(getComputedStyle(el.parentElement).paddingBottom),
        scrollable: el.scrollHeight > el.clientHeight,
      }))
      if (Math.abs(remaining.below - remaining.pad) > 1 || !remaining.scrollable) {
        failures.push({ width, table: 'full-page 对比', ...remaining })
      }
      const lastRowReachable = await fullCompare.evaluate((el) => {
        el.scrollTop = el.scrollHeight
        const last = el.querySelector('tbody:last-child tr:last-child')
        const reachable = last && last.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom
        el.scrollTop = 0
        return reachable
      })
      if (!lastRowReachable) failures.push({ width, table: 'full-page 对比', lastRowReachable })
      const compareHeights = await tableHeights(fullCompare)
      density.push({ width, table: 'full-page 对比', max: Math.max(...compareHeights) })
    } finally {
      await context.close()
    }
  }
  console.log('Table density:', JSON.stringify(density))
  failures.push(...density.filter(({ max }) => max !== undefined && (!Number.isFinite(max) || max > 26)))
  assert.deepEqual(failures, [], 'desktop row pitch, heights and full-page Compare layout')
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
  if (process.env.PERF === '1') {
    const perf = await open(1280, 800, 'dark', undefined, `?t=${screenshotTime}`)
    try { await checkReplayCadence(perf.page) } finally { await perf.context.close() }
  }
  for (const width of [900, 760]) {
    const tablet = await open(width, 800, 'dark', undefined, `?t=${screenshotTime}`)
    try {
      const group = tablet.page.getByRole('group', { name: '时间轴图层', exact: true })
      await group.getByRole('button', { name: '击毁用舰船图标', exact: true }).waitFor()
      const result = await group.evaluate((node) => {
        const edge = node.getBoundingClientRect()
        const buttons = [...node.querySelectorAll('button')]
        return {
          labels: buttons.map((button) => button.textContent.trim()),
          clipped: buttons.filter((button) => {
            const rect = button.getBoundingClientRect()
            return rect.left < edge.left - 1 || rect.right > edge.right + 1 || rect.right > innerWidth
              || !button.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
          }).map((button) => button.textContent.trim()),
        }
      })
      for (const label of ['点人', '击毁', '击毁用舰船图标']) assert.ok(result.labels.includes(label))
      assert.deepEqual(result.clipped, [], `timeline layer controls at ${width}px are visible and hit-testable`)
    } finally { await tablet.context.close() }
  }
  const touch = await open(390, 844, 'light', undefined, `?t=${screenshotTime}`, true)
  try {
    const page = touch.page
    assert.ok(await page.evaluate(() => matchMedia('(pointer: coarse)').matches))
    const bar = page.getByRole('group', { name: '回放控制' })
    const startRange = bar.getByRole('button', { name: '选段', exact: true })
    await startRange.waitFor()
    assert.equal(await page.locator('.eca-timeline-hint').count(), 0)
    const helpButton = await page.getByRole('button', { name: '时间轴用法' }).boundingBox()
    const rangeButton = await startRange.boundingBox()
    assert.ok(helpButton && rangeButton && Math.abs(helpButton.y - rangeButton.y) <= 2,
      'the touch range trigger and help share the playback row')
    await startRange.tap()
    const edit = page.getByRole('dialog', { name: '编辑选段' })
    await edit.getByRole('textbox', { name: '开始' }).fill('15:42:00')
    await edit.getByRole('textbox', { name: '结束' }).fill('15:44:00')
    await edit.getByRole('button', { name: '应用', exact: true }).tap()
    await bar.getByText('选段 15:42:00–15:44:00', { exact: true }).waitFor()
    assert.equal(await page.getByRole('slider', { name: '回放时间' }).getAttribute('aria-valuetext'), '15:42:00')
    assert.deepEqual(touch.errors, [])
  } finally { await touch.context.close() }
  console.log('Timeline: layer buttons visible at 900 and 760px, touch range created without a keyboard modifier')
  for (const size of [[390, 300], [300, 390]]) {
    const phoneStage = await open(size[0], 844, 'dark', 'reduce', `?t=${screenshotTime - 420}`)
    try { await assertReplayNames(phoneStage.page, size) } finally { await phoneStage.context.close() }
  }
  const zoomed = await open(1630, 940, 'dark', 'reduce', `?t=${screenshotTime - 420}`)
  try {
    for (const scale of [1.5, 2, 3]) await assertReplayNames(zoomed.page, undefined, scale)
  } finally { await zoomed.context.close() }
  for (const [width, height] of [[1630, 940], [1280, 800]]) {
    const openingFrame = await open(width, height, 'dark', 'reduce')
    try {
      // The opening frame reproduces the top-edge ship at 2×. At 3× its centered view has no ships.
      for (const scale of [1.5, 2]) await assertReplayNames(openingFrame.page, undefined, scale)
      if (width === 1280) {
        await openingFrame.page.goto(origin + route + `?t=${screenshotTime - 420}`)
        await assertReplayNames(openingFrame.page, undefined, 3)
      }
    } finally { await openingFrame.context.close() }
  }
  for (const [width, height, theme, motion] of [
    [1280, 800, 'dark'], [1280, 800, 'light'], [1630, 940, 'dark'], [900, 800, 'dark'], [900, 800, 'light'],
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
      assert.equal(await shot.page.locator('[data-module-area]').count(), width >= 1100 ? 3 : 2)
      assert.equal(await shot.page.locator('.battle-layout').getAttribute('data-density'), 'compact')
    }
    if ([1280, 900, 390].includes(width) && theme === 'dark' && !motion) await assertReplayNames(shot.page)
    if (width >= 1280 && theme === 'dark') {
      await assertClearPilotLabels(shot.page)
      await checkReplayOverlays(shot.page, width, height)
    }
    if (width >= 900 && theme === 'dark') await checkFightsAndChrome(shot.page, width)
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
      await heightGrip.press('ArrowUp')
      assert.equal((await stage.boundingBox()).height, startHeight - 16)
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
      await page.getByRole('dialog', { name: '时间轴使用说明' }).waitFor()
      await page.keyboard.press('Escape')
      await page.getByRole('dialog', { name: '时间轴使用说明' }).waitFor({ state: 'hidden' })
      await page.locator('.replay-noise summary').click()
      await page.getByRole('checkbox', { name: '隐藏无人机/战斗机伤害' }).check()
      await assertClearPilotLabels(page)
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
      const beforeKeyResize = await feed.boundingBox()
      const keyboardGrip = feed.getByRole('group', { name: '调整 事件 大小' })
      await keyboardGrip.press('Shift+ArrowRight')
      await keyboardGrip.press('ArrowDown')
      assert.deepEqual(await feed.boundingBox(), {
        ...beforeKeyResize, width: beforeKeyResize.width + 32, height: beforeKeyResize.height + 8,
      })
      await page.keyboard.press('Escape')
      assert.equal(await feed.getAttribute('data-floating'), 'true', 'Escape leaves the window open when exiting resize')
      assert.ok(await handle.evaluate((node) => document.activeElement === node))
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
      const legend = page.getByRole('region', { name: '交互图例', exact: true })
      const fights = page.getByRole('region', { name: '此刻交火', exact: true })
      const damage = page.locator('.replay-noise-popover')
      const range = page.locator('.eca-timeline-range button[title="取消选段"]')
      await page.getByRole('button', { name: '交互图例', exact: true }).click()
      await page.locator('.replay-noise summary').click()
      await damage.waitFor()
      await chart.press('Shift+ArrowRight')
      await range.waitFor()
      await page.keyboard.press('Escape')
      await damage.waitFor({ state: 'hidden' })
      assert.ok(await legend.isVisible(), 'closing the filter keeps the legend open')
      for (const window of [legend, fights]) {
        await chart.focus()
        await page.keyboard.press('Escape')
        await window.waitFor({ state: 'hidden' })
        assert.equal(await feed.getAttribute('data-floating'), 'true', 'replay windows stack above module floats')
        assert.ok(await range.isVisible(), 'closing a window keeps the range')
      }
      await chart.focus()
      await page.keyboard.press('Escape')
      assert.equal(await feed.getAttribute('data-floating'), 'false')
      assert.ok(await range.isVisible())
      await page.keyboard.press('Escape')
      await range.waitFor({ state: 'hidden' })
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
  try {
    await browser?.close()
  } finally {
    await server.close()
  }
}
