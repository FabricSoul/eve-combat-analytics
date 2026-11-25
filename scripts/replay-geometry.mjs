// Exercise the production replay UI in Chromium with all 17 real J125990 logs.
import assert from 'node:assert/strict'
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { brId, fixture, launchChromium, root, startFixtureBattle } from './fixture-battle.mjs'

const t = 1750606982420
const output = process.env.REPLAY_GEOMETRY_OUTPUT ?? join(root, 'build/replay-geometry')
const referencePath = process.env.REPLAY_REFERENCE
const samples = [[900, 680, 79], [900, 680, 120], [900, 680, 183], [1630, 940]]
const anchorNames = ['Beatris Dallocort', 'Blanchard2213']
const failures = []

async function stabilize(page) {
  await page.evaluate(async () => {
    for (let frame = 0; frame < 5; frame++) await new Promise(requestAnimationFrame)
  })
}

async function measure(stage, requiredKeys = []) {
  return stage.evaluate((node, requiredKeys) => {
    const { left, top, right, bottom, width, height } = node.getBoundingClientRect()
    const includes = (rect) => rect.left >= left - 0.02 && rect.right <= right + 0.02
      && rect.top >= top - 0.02 && rect.bottom <= bottom + 0.02
    const intersects = (a, b, tolerance = 0) => a.left < b.right - tolerance && a.right > b.left + tolerance
      && a.top < b.bottom - tolerance && a.bottom > b.top + tolerance
    const stage = { left, right, top, bottom }
    const labels = new Map([...node.querySelectorAll('[data-pilot-label][data-positioned]')]
      .map((label) => [label.dataset.pilotLabel, label.getBoundingClientRect()]))
    const zoom = node.querySelector('.replay-stage-zoom').getBoundingClientRect()
    const ships = [...node.querySelectorAll('.replay-marker[data-present]')].map((marker) => {
      const hull = marker.querySelector('.replay-pilot')
      const ring = hull.getBoundingClientRect()
      const badge = hull.querySelector('.replay-pilot-portrait').getBoundingClientRect()
      const x = ring.x + ring.width / 2
      const y = ring.y + ring.height / 2
      const hit = (clientX, clientY) => document.elementFromPoint(clientX, clientY)?.closest('.replay-marker') === marker
      const key = marker.dataset.pilotKey
      const label = labels.get(key)
      const reach = label ? Math.hypot(Math.max(0, label.left - x, x - label.right), Math.max(0, label.top - y, y - label.bottom)) : null
      let gridHit = false
      for (let i = 1; i <= 7 && !gridHit; i++) {
        for (let j = 1; j <= 7 && !gridHit; j++) gridHit = hit(ring.left + ring.width * i / 8, ring.top + ring.height * j / 8)
      }
      return { key, name: hull.getAttribute('aria-label'), x: x - left, y: y - top,
        label: label && { x: label.x - left, y: label.y - top, width: label.width, height: label.height },
        inView: intersects(ring, stage), hullFits: includes(ring), ringRadius: ring.width / 2,
        badgeFits: Math.abs(badge.width - 16) < 0.02 && Math.abs(badge.height - 16) < 0.02 && includes(badge),
        centerHit: hit(x, y), gridHit, reach, neutral: marker.hasAttribute('data-unassigned'),
        required: hull.dataset.log === 'true' || requiredKeys.includes(key) }
    })
    const inView = ships.filter((ship) => ship.inView)
    const overlaps = [...labels.values()].flatMap((a, index, rects) => rects.slice(index + 1).filter((b) => intersects(a, b))).length
    const required = inView.filter((ship) => ship.required)
    const neutral = ships.filter((ship) => ship.neutral)
    const max = Math.max(0, ...required.map(({ reach }) => reach ?? 0))
    const controls = [...node.querySelectorAll('.replay-control-trigger, .replay-noise summary, .replay-zoom')]
    const actionable = [...controls.filter((control) => !control.matches('.replay-zoom')),
      ...node.querySelectorAll('.replay-stage-zoom button')]
    const controlHits = actionable.filter((control) => {
      const rect = control.getBoundingClientRect()
      return control.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
    }).length
    const chromeBoxes = [...controls, ...node.querySelectorAll('.replay-legend > span'),
      ...controls.map((control) => document.getElementById(control.getAttribute('aria-controls'))).filter(Boolean)]
      .map((element) => element.getBoundingClientRect()).filter((rect) => rect.width && rect.height)
    const chrome = chromeBoxes.map((rect) => ({ x: rect.x - left, y: rect.y - top, width: rect.width, height: rect.height }))
    const labelsUnderChrome = [...labels.values()].filter((label) => chromeBoxes.some((box) => intersects(label, box, 0.02))).length
    const topInset = Math.ceil(node.querySelector('.replay-header-actions').getBoundingClientRect().bottom - top)
    return { width, height, topInset, hulls: ships.length, contained: ships.filter((ship) => ship.hullFits).length,
      centers: ships.filter((ship) => ship.centerHit).length, gridHits: ships.filter((ship) => ship.gridHit).length,
      portraits: ships.filter((ship) => ship.badgeFits).length,
      names: inView.filter(({ reach }) => reach !== null).length, inView: inView.length, overlaps, labelsUnderChrome,
      required: required.length, requiredNames: required.filter(({ reach }) => reach !== null).length,
      maxRequiredReach: Number(max.toFixed(2)), neutralsBelow: neutral.filter(({ y }) => y > height / 2).length,
      neutrals: neutral.length, zoomInsets: [zoom.left - left, bottom - zoom.bottom],
      controlHits, controls: actionable.length, ships, chrome }
  }, requiredKeys)
}

function metrics({ ships, chrome, ...summary }) {
  return summary
}

function check(condition, name) {
  if (!condition) failures.push(name)
}

await mkdir(output, { recursive: true })
const server = await startFixtureBattle()
const { origin } = server
let browser
try {
  for (const file of (await readdir(join(fixture, 'logs'))).sort()) {
    if (!file.endsWith('.txt.gz')) continue
    const response = await fetch(`${origin}/api/battles/${brId}/logs`, {
      method: 'POST', body: gunzipSync(await readFile(join(fixture, 'logs', file))),
    })
    assert.equal(response.status, 200, await response.text())
  }
  const summary = await (await fetch(`${origin}/api/battles/${brId}`)).json()
  assert.equal(summary.logs.length, 17)
  browser = await launchChromium()
  if (referencePath) {
    const reference = await browser.newPage({ viewport: { width: 1630, height: 940 } })
    await reference.goto(pathToFileURL(referencePath).href)
    await reference.screenshot({ path: join(output, 'approved-replay.png') })
    await reference.close()
  }
  const analysisPath = `/api/battles/${brId}/analysis`
  for (const [width, height, mapHeight] of samples) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'dark',
      reducedMotion: process.env.REPLAY_MOTION === 'normal' ? 'no-preference' : 'reduce' })
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(5000)
    await page.goto(`${origin}/b/${brId}?t=${t}`)
    const stage = page.locator('.replay-stage')
    const grip = page.getByRole('separator', { name: '调整舞台高度' })
    await stage.locator('.replay-marker[data-present] .replay-pilot[data-log="true"]').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const initialHeight = (await stage.boundingBox()).height
    if (mapHeight && mapHeight !== initialHeight) {
      const { x, y, width, height } = await grip.boundingBox()
      await page.mouse.move(x + width / 2, y + height / 2)
      await page.mouse.down()
      await page.mouse.move(x + width / 2, y + height / 2 + mapHeight - initialHeight)
      await page.mouse.up()
    }
    await page.mouse.move(0, 0)
    await stabilize(page)
    const overview = await measure(stage)
    if (mapHeight) assert.equal(overview.height, mapHeight)
    const name = `${width}x${height}-map${overview.height}`
    console.log(name, 'overview', JSON.stringify(metrics(overview)))
    check(overview.hulls === 49, `${name} real fixture count`)
    check(overview.contained === overview.hulls && overview.centers === overview.hulls && overview.gridHits === overview.hulls, `${name} hull containment and hits`)
    check(overview.portraits === overview.hulls, `${name} badge containment`)
    check(overview.requiredNames === overview.required && overview.maxRequiredReach <= 40, `${name} logged names within 40 px`)
    check(overview.labelsUnderChrome === 0, `${name} overview label visibility`)
    check(overview.neutrals > 0 && overview.neutralsBelow === overview.neutrals, `${name} neutral centers below midpoint`)
    check(overview.zoomInsets.every((inset) => Math.abs(inset - 8) < 0.02), `${name} zoom insets [8, 8]`)
    check(overview.controlHits === overview.controls, `${name} replay controls remain clickable`)
    await stage.screenshot({ path: join(output, `${name}.png`) })
    const paused = await measure(stage)
    const priorCenters = new Map(overview.ships.map(({ key, x, y }) => [key, { x, y }]))
    const drift = Math.max(...paused.ships.map(({ key, x, y }) => {
      const prior = priorCenters.get(key)
      return prior ? Math.hypot(x - prior.x, y - prior.y) : Infinity
    }))
    console.log(name, 'paused DOM drift (px)', drift)
    check(drift < 0.02, `${name} paused DOM remains still`)

    const forces = await page.evaluate(async ({ analysisPath, summary, present, width, height, chrome, topInset, t }) => {
      const { buildScene, makeLayout } = await import('/src/app/battle/replay/scene.ts')
      const analysis = await (await fetch(analysisPath)).json()
      const { defaultOursSide, sideOrder } = await import('/src/app/lib/sides.ts')
      const order = sideOrder(analysis, defaultOursSide(summary))
      const scene = buildScene(analysis, summary.meta.killmails, order)
      const live = scene.edges.filter((edge) => edge.t > t - 3000 && edge.t <= t)
      const active = new Set(present)
      const pairs = live.filter((edge) => active.has(edge.from) && active.has(edge.to)
        && analysis.entities[edge.from].side >= 0 && analysis.entities[edge.to].side >= 0
        && analysis.entities[edge.from].side !== analysis.entities[edge.to].side)
      const average = (layout) => {
        const distances = pairs.map(({ from, to }) => {
          const a = layout.byKey.get(from)
          const b = layout.byKey.get(to)
          return Math.hypot(a.x - b.x, a.y - b.y)
        })
        return distances.reduce((sum, distance) => sum + distance, 0) / distances.length
      }
      const groupGap = (layout) => {
        const [own, opposing] = order.map((side) => {
          const group = layout.nodes.filter(({ entity }) => active.has(entity.key) && entity.side === side)
          return { x: group.reduce((sum, node) => sum + node.x, 0) / group.length,
            y: group.reduce((sum, node) => sum + node.y, 0) / group.length }
        })
        return Math.hypot(own.x - opposing.x, own.y - opposing.y)
      }
      const quiet = makeLayout(scene.pilots, order, width, height, topInset)
      const exchange = makeLayout(scene.pilots, order, width, height, topInset)
      quiet.placeVisible(active, [], chrome)
      exchange.placeVisible(active, live, chrome)
      const before = exchange.nodes.map(({ x, y }) => [x, y])
      for (let frame = 0; frame < 10; frame++) exchange.placeVisible(active, live, chrome)
      return { events: pairs.length, quiet: Number(groupGap(quiet).toFixed(2)), exchange: Number(groupGap(exchange).toFixed(2)),
        pairGapQuiet: Number(average(quiet).toFixed(2)), pairGapExchange: Number(average(exchange).toFixed(2)),
        pausedDrift: Math.max(...exchange.nodes.map(({ x, y }, index) => Math.hypot(x - before[index][0], y - before[index][1]))) }
    }, { analysisPath, summary, present: overview.ships.map(({ key }) => key),
      width: overview.width, height: overview.height, chrome: overview.chrome, topInset: overview.topInset, t })
    console.log(name, 'exchange', JSON.stringify(forces))
    check(forces.events > 0 && forces.exchange < forces.quiet && forces.pausedDrift === 0, `${name} exchange pulls closer and remains stable`)

    const hover = stage.getByRole('button', { name: /^Hindalah Dian(?: ·|$)/ })
    const select = stage.getByRole('button', { name: /^Cunning guy(?: ·|$)/ })
    async function inspect(marker, click) {
      const key = await marker.locator('..').getAttribute('data-pilot-key')
      const { x, y, width, height } = await marker.boundingBox()
      await page.mouse.move(x + width / 2, y + height / 2)
      if (click) await page.mouse.click(x + width / 2, y + height / 2)
      await stabilize(page)
      check(await stage.locator(`[data-pilot-label="${key}"][data-${click ? 'selected' : 'inspected'}="true"]`).count() === 1,
        `${name} ${click ? 'selection' : 'hover'} activates the pilot label`)
      const { reach } = (await measure(stage, [key])).ships.find((ship) => ship.key === key)
      check(reach !== null && reach <= 40, `${name} ${click ? 'selected' : 'hovered'} name within 40 px`)
      return reach === null ? null : Number(reach.toFixed(2))
    }
    console.log(name, 'inspection', JSON.stringify({ hoverReach: await inspect(hover, false), selectReach: await inspect(select, true) }))
    await page.keyboard.press('Escape')
    await page.mouse.move(0, 0)
    for (const anchor of anchorNames) {
      const pilot = stage.getByRole('button', { name: new RegExp(`^${anchor}(?: ·|$)`) })
      for (const scale of [1.5, 2, 3]) {
        await stage.getByRole('button', { name: '适应全部' }).click()
        await stabilize(page)
        const { x, y, width, height } = await pilot.boundingBox()
        await pilot.dispatchEvent('wheel', {
          clientX: x + width / 2, clientY: y + height / 2, deltaY: -Math.log(scale + 0.00001) / 0.002,
        })
        await page.waitForFunction(() => document.querySelector('.replay-stage').hasAttribute('data-all-names'))
        await stabilize(page)
        const zoom = await measure(stage)
        const after = await pilot.boundingBox()
        const anchorShift = Number(Math.hypot(x - after.x, y - after.y).toFixed(2))
        if (zoom.overlaps || zoom.labelsUnderChrome) {
          await writeFile(join(output, `${name}-${scale}-${anchor.split(' ')[0]}.json`), JSON.stringify(zoom, null, 2))
        }
        console.log(name, `zoom ${scale}× ${anchor}`, JSON.stringify({ names: zoom.names, inView: zoom.inView,
          overlaps: zoom.overlaps, labelsUnderChrome: zoom.labelsUnderChrome, maxRequiredReach: zoom.maxRequiredReach, anchorShift }))
        check(zoom.names === zoom.inView && zoom.overlaps === 0, `${name} ${scale}× ${anchor} names without overlap`)
        check(zoom.labelsUnderChrome === 0, `${name} ${scale}× ${anchor} label visibility`)
        const nearRequired = zoom.ships.filter(({ required, inView, reach, ringRadius }) =>
          required && inView && reach !== null && reach <= 40 + ringRadius + 0.02).length
        check(zoom.requiredNames === zoom.required && nearRequired === zoom.required,
          `${name} ${scale}× ${anchor} required names within zoom reach`)
        if (mapHeight === 79) check(zoom.maxRequiredReach <= 40, `${name} ${scale}× ${anchor} required names within 40 px`)
        // Chromium rounds WheelEvent coordinates to whole CSS pixels.
        check(anchorShift <= Math.SQRT2 * (scale - 1) + 0.05, `${name} ${scale}× ${anchor} stays under the cursor`)
        if (scale === 1.5) await stage.screenshot({ path: join(output, `${name}-150-${anchor.split(' ')[0]}.png`) })
      }
    }
    await stage.getByRole('button', { name: '适应全部' }).click()
    await stabilize(page)
    const legend = stage.getByRole('button', { name: '交互图例', exact: true })
    await legend.click()
    await page.getByRole('region', { name: '交互图例', exact: true }).waitFor()
    await stabilize(page)
    const open = await measure(stage)
    console.log(name, 'with both windows open', JSON.stringify({ centers: open.centers, hulls: open.hulls,
      gridHits: open.gridHits, controls: open.controls, controlHits: open.controlHits }))
    check(open.centers === open.hulls && open.gridHits === open.hulls, `${name} open windows clear marker centers`)
    check(open.controlHits === open.controls, `${name} both windows leave replay controls reachable`)
    await page.screenshot({ path: join(output, `${name}-open-windows.png`) })
    await context.close()
  }
  assert.deepEqual(failures, [], 'replay geometry acceptance')
  console.log('Replay geometry passed at all four map sizes and all 24 pilot-anchored zooms.')
} finally {
  await browser?.close()
  await server.close()
}
