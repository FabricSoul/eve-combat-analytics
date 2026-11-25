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
const normalMotion = process.env.REPLAY_MOTION === 'normal'
const samples = [
  ...[[320, 568], [390, 844], [740, 420]].map(([width, height]) => ({ width, height, sheet: 'first' })),
  ...[760, 900].flatMap((width) => [79, 120, 183].map((mapHeight) => ({ width, height: 680, mapHeight }))),
  { width: 1630, height: 940 },
  { width: 820, height: 500, coarseStage: 'default' },
  ...['default', 'min', 'max'].map((coarseStage) => ({ width: 900, height: 800, coarseStage })),
  { width: 1280, height: 800, coarseStage: 'default' },
  ...[844, 1000].flatMap((height) => ['half', 'peek'].map((sheet) => ({ width: 390, height, sheet }))),
]
const anchorNames = ['Beatris Dallocort', 'Blanchard2213']
const auditedTimes = [1750608294000, 1750608498000] // 16:04:54 and 16:08:18 UTC
const failures = []
let zoomCount = 0

async function stabilize(page) {
  await page.evaluate(async () => {
    for (let frame = 0; frame < 5; frame++) await new Promise(requestAnimationFrame)
  })
}

async function zoomAt(page, stage, pilot, scale) {
  await stage.getByRole('button', { name: '适应全部' }).click()
  await page.mouse.move(0, 0)
  await stabilize(page)
  const anchor = await pilot.boundingBox()
  await pilot.dispatchEvent('wheel', {
    clientX: anchor.x + anchor.width / 2, clientY: anchor.y + anchor.height / 2,
    deltaY: -Math.log(scale + 0.00001) / 0.002,
  })
  await page.waitForFunction(() => document.querySelector('.replay-stage').hasAttribute('data-all-names'))
  await stabilize(page)
  return anchor
}

async function measure(stage, requiredKeys = []) {
  return stage.evaluate((node, requiredKeys) => {
    const { left, top, right, bottom, width, height } = node.getBoundingClientRect()
    const includes = (rect) => rect.left >= left - 0.02 && rect.right <= right + 0.02
      && rect.top >= top - 0.02 && rect.bottom <= bottom + 0.02
    const intersects = (a, b, tolerance = 0) => a.left < b.right - tolerance && a.right > b.left + tolerance
      && a.top < b.bottom - tolerance && a.bottom > b.top + tolerance
    const stage = { left, right, top, bottom }
    const labelElements = [...node.querySelectorAll('[data-pilot-label][data-positioned]')]
    const labels = new Map(labelElements.map((label) => [label.dataset.pilotLabel, label.getBoundingClientRect()]))
    const truncated = new Set(labelElements.filter((label) => {
      const text = label.firstElementChild
      const range = document.createRange()
      range.selectNodeContents(text)
      return range.getBoundingClientRect().width > text.getBoundingClientRect().width + 0.05
    }).map((label) => label.dataset.pilotLabel))
    const zoom = node.querySelector('.replay-zoom').getBoundingClientRect()
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
        centerHit: hit(x, y), gridHit, reach, truncated: truncated.has(key), neutral: marker.hasAttribute('data-unassigned'),
        side: marker.style.getPropertyValue('--replay-side'),
        required: hull.dataset.log === 'true' || requiredKeys.includes(key) }
    })
    const inView = ships.filter((ship) => ship.inView)
    const overlaps = [...labels.values()].flatMap((a, index, rects) => rects.slice(index + 1).filter((b) => intersects(a, b, 0.02))).length
    const required = inView.filter((ship) => ship.required)
    const neutral = ships.filter((ship) => ship.neutral)
    const max = Math.max(0, ...required.map(({ reach }) => reach ?? 0))
    const controls = [...node.querySelectorAll('.replay-control-trigger, .replay-noise summary, .replay-zoom')]
    const actionable = [...controls.filter((control) => !control.matches('.replay-zoom')),
      ...node.querySelectorAll('.replay-zoom button')]
    const hint = node.closest('.battle-layout').querySelector('.eca-timeline-hint')?.getBoundingClientRect()
    const controlsUnderHint = hint ? actionable.filter((control) => intersects(hint, control.getBoundingClientRect())).length : 0
    const containedControls = actionable.filter((control) => includes(control.getBoundingClientRect())).length
    const touch = matchMedia('(pointer: coarse)').matches
    const controlHits = actionable.filter((control) => {
      const rect = control.getBoundingClientRect()
      if (!touch) return control.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2))
      if (rect.width < 44 || rect.height < 44) return false
      const offsets = [1, 11, 22, 33, 43]
      const x = rect.left + (rect.width - 44) / 2
      const y = rect.top + (rect.height - 44) / 2
      return offsets.every((dx) => offsets.every((dy) => control.contains(document.elementFromPoint(x + dx, y + dy))))
    }).length
    const chromeBoxes = [...controls, ...node.querySelectorAll('.replay-legend > span, .replay-tooltip[data-positioned], .replay-miss-tooltip[data-positioned]'),
      ...controls.map((control) => document.getElementById(control.getAttribute('aria-controls'))).filter(Boolean)]
      .map((element) => element.getBoundingClientRect()).filter((rect) => rect.width && rect.height)
    const chrome = chromeBoxes.map((rect) => ({ x: rect.x - left, y: rect.y - top, width: rect.width, height: rect.height }))
    const labelsUnderChrome = [...labels.values()].filter((label) => chromeBoxes.some((box) => intersects(label, box, 0.02))).length
    const topInset = Math.ceil(node.querySelector('.replay-header-actions').getBoundingClientRect().bottom - top)
    const own = ships.filter(({ side, neutral }) => !neutral && side === 'var(--color-side-0)')
    const opposing = ships.filter(({ side, neutral }) => !neutral && side === 'var(--color-side-1)')
    const meanX = (fleet) => fleet.reduce((total, { x }) => total + x, 0) / fleet.length
    return { width, height, topInset, hulls: ships.length, contained: ships.filter((ship) => ship.hullFits).length,
      centers: ships.filter((ship) => ship.centerHit).length, gridHits: ships.filter((ship) => ship.gridHit).length,
      portraits: ships.filter((ship) => ship.badgeFits).length,
      names: inView.filter(({ key }) => labels.has(key) && includes(labels.get(key))).length, inView: inView.length, overlaps, labelsUnderChrome,
      required: required.length, requiredNames: required.filter(({ key }) => labels.has(key) && includes(labels.get(key))).length,
      requiredTruncated: required.filter((ship) => ship.truncated).length, truncated: inView.filter((ship) => ship.truncated).length,
      maxRequiredReach: Number(max.toFixed(2)),
      maxReach: Number(Math.max(0, ...inView.map(({ reach }) => reach ?? 0)).toFixed(2)), neutralsBelow: neutral.filter(({ y }) => y > height / 2).length,
      neutrals: neutral.length, zoomInsets: [zoom.left - left, bottom - zoom.bottom],
      fleetEdges: [Math.max(0, ...own.map(({ x }) => x)), Math.min(width, ...opposing.map(({ x }) => x))],
      fleetCenters: [meanX(own), meanX(opposing)],
      controlHits, containedControls, controlsUnderHint, controls: actionable.length,
      ships: ships.map((ship) => {
        const label = labels.get(ship.key)
        return { ...ship, labelVisible: Boolean(label && includes(label) && !chromeBoxes.some((box) => intersects(label, box, 0.02))) }
      }), chrome }
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
  for (const { width, height, mapHeight, sheet, coarseStage } of samples) {
    const context = await browser.newContext({ viewport: { width, height }, colorScheme: 'dark', hasTouch: Boolean(sheet || coarseStage),
      reducedMotion: normalMotion ? 'no-preference' : 'reduce' })
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    const page = await context.newPage()
    page.setDefaultTimeout(15000)
    await page.goto(`${origin}/b/${brId}?t=${t}`)
    const stage = page.locator('.replay-stage')
    const grip = page.getByRole('separator', { name: '调整舞台高度' })
    await stage.locator('.replay-marker[data-present] .replay-pilot[data-log="true"]').first().waitFor()
    await page.evaluate(() => document.fonts.ready)
    const sheetGrip = page.getByRole('slider', { name: '面板高度' })
    if (sheet === 'peek') await sheetGrip.press('Home')
    if (sheet === 'half') {
      await sheetGrip.press('Home')
      await sheetGrip.press('ArrowUp')
    }
    const initialHeight = (await stage.boundingBox()).height
    if (coarseStage === 'min' || coarseStage === 'max' || (mapHeight && mapHeight !== initialHeight)) {
      const { x, y, width: gripWidth, height: gripHeight } = await grip.boundingBox()
      await page.mouse.move(x + gripWidth / 2, y + gripHeight / 2)
      await page.mouse.down()
      const destination = coarseStage === 'min' ? 1 : coarseStage === 'max' ? height - 1 : y + gripHeight / 2 + mapHeight - initialHeight
      await page.mouse.move(x + gripWidth / 2, destination)
      await page.mouse.up()
    }
    await page.mouse.move(0, 0)
    // A paused snapshot still has the 320 ms impact shake from the selected tick.
    if (normalMotion) await page.waitForTimeout(400)
    await stabilize(page)
    const overview = await measure(stage)
    if (mapHeight) assert.equal(overview.height, mapHeight)
    const name = `${width}x${height}-map${overview.height}${sheet ? `-${sheet}` : ''}${coarseStage ? `-coarse-${coarseStage}` : ''}`
    console.log(name, 'overview', JSON.stringify(metrics(overview)))
    await stage.screenshot({ path: join(output, `${name}.png`) })
    if (coarseStage) {
      const geometry = await grip.evaluate((element) => {
        const stage = element.closest('.battle-stage')
        const height = stage.getBoundingClientRect().height
        const modules = stage.nextElementSibling.getBoundingClientRect()
        const lower = Math.max(0, Math.min(innerHeight, modules.bottom) - modules.top)
        return { height, now: Number(element.getAttribute('aria-valuenow')),
          min: Number(element.getAttribute('aria-valuemin')), max: Number(element.getAttribute('aria-valuemax')),
          lower }
      })
      console.log(name, 'stage bounds', JSON.stringify(geometry))
      check(overview.height >= 140, `${name} map floor`)
      check(geometry.height === geometry.now, `${name} measured stage agrees with ARIA`)
      if (coarseStage !== 'default') check(geometry.height === geometry[coarseStage], `${name} reaches its stage limit`)
      if (coarseStage === 'default' && height === 800) {
        check(geometry.height === 496 && geometry.lower >= 220, `${name} stage default leaves 220 px below`)
      }
      if (coarseStage === 'max') check(geometry.height === 600, `${name} stage max is 75%`)
      await page.screenshot({ path: join(output, `${name}-workspace.png`) })
    }
    if (sheet === 'first') {
      const hint = page.getByRole('button', { name: '关闭时间轴提示' })
      check(await hint.isVisible(), `${name} first-visit hint is shown`)
      await page.screenshot({ path: join(output, `${name}-first-visit.png`) })
      check(overview.height >= 160, `${name} first-visit map is at least 160 px tall`)
      check(overview.controlsUnderHint === 0, `${name} hint clears replay controls`)
      check(await sheetGrip.getAttribute('aria-valuenow') === (height === 844 ? '1' : '0'), `${name} initial sheet snap`)
    }
    check(overview.hulls === 49, `${name} real fixture count`)
    check(overview.contained === overview.hulls && overview.gridHits === overview.hulls
      && (sheet === 'first' || overview.centers === overview.hulls), `${name} hull containment and hits`)
    check(overview.portraits === overview.hulls, `${name} badge containment`)
    check(overview.requiredNames === overview.required && overview.maxRequiredReach <= 40, `${name} logged names within 40 px`)
    check(overview.requiredTruncated === 0, `${name} overview required labels show full text`)
    check(overview.overlaps === 0, `${name} overview names without overlap`)
    check(overview.labelsUnderChrome === 0, `${name} overview label visibility`)
    check(overview.neutrals > 0 && overview.neutralsBelow === overview.neutrals, `${name} neutral centers below midpoint`)
    if (sheet === 'first' && width >= 430) check(overview.fleetCenters[0] < overview.fleetCenters[1],
      `${name} own fleet center stays left of opposing fleet center`)
    else if (sheet) check(overview.fleetEdges[0] > 0 && overview.fleetEdges[1] < width
      && overview.fleetEdges[0] < overview.fleetEdges[1], `${name} own fleet stays left of opposing fleet`)
    else {
      const expectedBottomInset = mapHeight === 79 ? 16 : 8
      check(Math.abs(overview.zoomInsets[0] - 8) < 0.02 && Math.abs(overview.zoomInsets[1] - expectedBottomInset) < 0.02,
        `${name} zoom insets [8, ${expectedBottomInset}]`)
    }
    check(overview.controlHits === overview.controls && overview.containedControls === overview.controls,
      `${name} replay controls are contained and clickable`)
    if (sheet) check(Math.abs(overview.zoomInsets[0] - 8) < 0.02 && Math.abs(overview.zoomInsets[1] - 8) < 0.02,
      `${name} zoom stays at the lower left of the phone map`)
    if (overview.controlHits !== overview.controls) {
      await context.close()
      continue
    }
    if (sheet === 'first') {
      await stage.getByRole('button', { name: '放大', exact: true }).tap()
      check(await stage.getAttribute('data-zoomed') !== null, `${name} zoom-in control changes the camera`)
      await stage.getByRole('button', { name: '缩小', exact: true }).tap()
      check(await stage.getAttribute('data-zoomed') === null, `${name} zoom-out control returns to the overview`)
      await stage.getByRole('button', { name: '放大', exact: true }).tap()
      await stage.getByRole('button', { name: '适应全部' }).tap()
      check(await stage.getAttribute('data-zoomed') === null, `${name} Fit resets the camera`)
      await page.mouse.move(0, 0)
      await stabilize(page)
    }
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
      const { reach, truncated, labelVisible } = (await measure(stage, [key])).ships.find((ship) => ship.key === key)
      check(reach !== null && reach <= 40, `${name} ${click ? 'selected' : 'hovered'} name within 40 px`)
      check(!truncated, `${name} ${click ? 'selected' : 'hovered'} name shows full text`)
      check(labelVisible, `${name} ${click ? 'selected' : 'hovered'} name clears replay chrome`)
      return reach === null ? null : Number(reach.toFixed(2))
    }
    if (!sheet) {
      console.log(name, 'inspection', JSON.stringify({ hoverReach: await inspect(hover, false), selectReach: await inspect(select, true) }))
      await page.keyboard.press('Escape')
    }
    await page.mouse.move(0, 0)
    const anchors = coarseStage || (width === 900 && mapHeight === 79) ? [...anchorNames, 'center'] : anchorNames
    for (const anchor of anchors) {
      const pilot = anchor === 'center' ? stage : stage.getByRole('button', { name: new RegExp(`^${anchor}(?: ·|$)`) })
      for (const scale of anchor === 'center' && !coarseStage ? [1.5] : [1.5, 2, 3]) {
        zoomCount++
        const { x, y } = await zoomAt(page, stage, pilot, scale)
        const zoom = await measure(stage)
        const after = await pilot.boundingBox()
        const anchorShift = Number(Math.hypot(x - after.x, y - after.y).toFixed(2))
        if (zoom.overlaps || zoom.labelsUnderChrome || zoom.truncated || zoom.names !== zoom.inView || zoom.maxReach > 40) {
          await writeFile(join(output, `${name}-${scale}-${anchor.split(' ')[0]}.json`), JSON.stringify(zoom, null, 2))
        }
        console.log(name, `zoom ${scale}× ${anchor}`, JSON.stringify({ names: zoom.names, inView: zoom.inView,
          requiredTruncated: zoom.requiredTruncated, truncated: zoom.truncated, overlaps: zoom.overlaps,
          labelsUnderChrome: zoom.labelsUnderChrome, maxRequiredReach: zoom.maxRequiredReach, maxReach: zoom.maxReach, anchorShift }))
        check(zoom.names === zoom.inView && zoom.overlaps === 0, `${name} ${scale}× ${anchor} names without overlap`)
        check(zoom.truncated === 0, `${name} ${scale}× ${anchor} every in-view label shows full text`)
        check(zoom.labelsUnderChrome === 0, `${name} ${scale}× ${anchor} label visibility`)
        const near = zoom.ships.filter(({ inView, reach, ringRadius, required }) =>
          inView && reach !== null && reach <= 40 + (zoom.height < 100 && required ? 0 : ringRadius + 2) + 0.02).length
        check(near === zoom.inView, `${name} ${scale}× ${anchor} all names within zoom reach`)
        if (mapHeight === 79) check(zoom.maxRequiredReach <= 40.03, `${name} ${scale}× ${anchor} required names within 40 px`)
        // Chromium rounds WheelEvent coordinates to whole CSS pixels.
        if (anchor !== 'center') check(anchorShift <= Math.SQRT2 * (scale - 1) + 0.05, `${name} ${scale}× ${anchor} stays under the cursor`)
        if (scale === 1.5) await stage.screenshot({ path: join(output, `${name}-150-${anchor.split(' ')[0]}.png`) })
      }
    }
    await stage.getByRole('button', { name: '适应全部' }).click()
    await stabilize(page)
    if (sheet) {
      const trigger = stage.getByRole('button', { name: '此刻交火', exact: true })
      const present = await trigger.count() === 1
      check(present, `${name} has a Current Fights trigger`)
      if (present) {
        const panel = page.getByRole('region', { name: '此刻交火', exact: true })
        check(await trigger.getAttribute('aria-expanded') === 'false' && !await panel.isVisible(), `${name} fights starts collapsed`)
        const touchSize = async (control) => {
          const { width, height } = await control.boundingBox()
          return Math.min(width, height)
        }
        check(await touchSize(trigger) >= 44, `${name} fights trigger is 44 px`)
        await trigger.tap()
        await panel.waitFor()
        await stabilize(page)
        const close = panel.getByRole('button', { name: '关闭 此刻交火' })
        const open = await measure(stage)
        const map = await stage.boundingBox()
        const popup = await panel.boundingBox()
        const insideMap = popup.y >= map.y && popup.y + popup.height <= map.y + map.height
        const timelineControls = page.locator('.eca-timeline :is(.eca-timeline-bar, .eca-timeline-hint) button, [data-timeline-chart]')
        const clearOfTimeline = await timelineControls.evaluateAll((buttons, popup) => buttons.every((button) => {
          const { left, right, top, bottom } = button.getBoundingClientRect()
          return !button.checkVisibility() || popup.x >= right || popup.x + popup.width <= left
            || popup.y >= bottom || popup.y + popup.height <= top
        }), popup)
        check(insideMap, `${name} fights stays inside the map`)
        check(clearOfTimeline, `${name} fights clears the timeline chart, controls and first-visit hint`)
        check((await panel.locator('.battle-window-body').boundingBox()).height >= 44,
          `${name} fights body fits a complete touch row`)
        check(open.controlHits === open.controls && open.labelsUnderChrome === 0,
          `${name} fights leaves replay controls reachable and labels clear of the panel`)
        check(await touchSize(close) >= 44, `${name} fights close target is 44 px`)
        check((await panel.textContent()).includes('前 10 秒') && await panel.locator('tbody tr').count() > 0,
          `${name} shows the last 10 seconds of combat`)
        console.log(name, 'phone fights', JSON.stringify({ gridHits: open.gridHits, hulls: open.hulls, controls: open.controls,
          controlHits: open.controlHits, popup, insideMap, triggerTouch: await touchSize(trigger), closeTouch: await touchSize(close) }))
        await page.screenshot({ path: join(output, `${name}-open-fights.png`) })
        if (sheet === 'first') {
          const collapse = panel.getByRole('button', { name: '收起 此刻交火' })
          const hasCollapse = await collapse.count() === 1
          check(hasCollapse, `${name} fights has a collapse control`)
          if (hasCollapse) {
            check(await touchSize(collapse) >= 44, `${name} fights collapse target is 44 px`)
            await collapse.tap()
            check(!await panel.locator('tbody').isVisible(), `${name} collapsed fights hides the table`)
            const grip = panel.locator('.battle-module-handle')
            const gripRect = await grip.boundingBox()
            const beforeDrag = await panel.boundingBox()
            const dragStart = { x: gripRect.x + gripRect.width / 2, y: gripRect.y + gripRect.height / 2 }
            await page.mouse.move(dragStart.x, dragStart.y)
            await page.mouse.down()
            await page.mouse.move(dragStart.x - 24, dragStart.y + 24, { steps: 4 })
            await page.mouse.up()
            const afterDrag = await panel.boundingBox()
            const dragDistance = Math.hypot(afterDrag.x - beforeDrag.x, afterDrag.y - beforeDrag.y)
            check(dragDistance >= 8, `${name} collapsed fights moves on title grip drag`)
            check(afterDrag.y >= map.y && afterDrag.y + afterDrag.height <= map.y + map.height,
              `${name} dragged fights stays inside the map`)
            await panel.getByRole('button', { name: '还原 此刻交火' }).tap()
            check(await panel.locator('tbody').isVisible(), `${name} restore shows the fight table`)
            console.log(name, 'phone fights collapse and drag', JSON.stringify({ dragDistance, collapsedHeight: afterDrag.height }))
          }
        }
        await close.tap()
        check(!await panel.isVisible() && await trigger.getAttribute('aria-expanded') === 'false', `${name} closes Current Fights`)
        await trigger.press('Enter')
        await panel.waitFor()
        await page.keyboard.press('Escape')
        await panel.waitFor({ state: 'hidden' })
        check(await trigger.evaluate((button) => document.activeElement === button),
          `${name} Escape closes Current Fights and restores focus`)
      }
      if (sheet === 'first') {
        const filter = stage.locator('.replay-noise summary')
        await filter.tap()
        const popover = page.locator('.replay-noise-popover')
        await popover.waitFor()
        const filterOpen = await popover.isVisible()
        check(filterOpen, `${name} opens Damage Filter`)
        const filterRect = await popover.boundingBox()
        check(filterRect && filterRect.x >= 0 && filterRect.y >= 0 && filterRect.x + filterRect.width <= width
          && filterRect.y + filterRect.height <= height, `${name} clamps Damage Filter to the viewport`)
        await page.keyboard.press('Escape')
        const chosen = height === 844 ? '0' : '1'
        await sheetGrip.press('Home')
        if (chosen === '1') await sheetGrip.press('ArrowUp')
        await page.reload()
        await sheetGrip.waitFor()
        check(await sheetGrip.getAttribute('aria-valuenow') === chosen, `${name} remembers the user sheet snap after reload`)
        console.log(name, 'phone damage filter and sheet preference', JSON.stringify({ filterOpen, filterRect, chosen }))
      }
      await context.close()
      continue
    }
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
    if (coarseStage) {
      const zoomIn = stage.getByRole('button', { name: '放大', exact: true })
      await zoomIn.tap()
      await zoomIn.tap()
      await stabilize(page)
      const zoom = await measure(stage)
      check(await stage.getAttribute('data-all-names') !== null, `${name} two touch zooms reveal all names`)
      check(zoom.names === zoom.inView && zoom.truncated === 0 && zoom.labelsUnderChrome === 0 && zoom.overlaps === 0,
        `${name} touch zoom contains every in-view name with both windows open`)
      zoomCount++
    }
    await context.close()
  }

  const analysis = await (await fetch(origin + analysisPath)).json()
  const eventsBySecond = new Map()
  for (const { t } of analysis.interactions) {
    const second = Math.floor(t / 1000) * 1000
    eventsBySecond.set(second, (eventsBySecond.get(second) ?? 0) + 1)
  }
  const denseTimes = [...auditedTimes]
  for (const [time] of [...eventsBySecond].sort((a, b) => b[1] - a[1])) {
    if (denseTimes.length >= 6) break
    if (denseTimes.every((other) => Math.abs(time - other) >= 60_000)) denseTimes.push(time)
  }
  for (const coarse of [true, false]) {
    const context = await browser.newContext({ viewport: { width: 900, height: coarse ? 800 : 680 }, hasTouch: coarse,
      colorScheme: 'dark', reducedMotion: normalMotion ? 'no-preference' : 'reduce' })
    await context.route('**/*', (route) => new URL(route.request().url()).origin === origin ? route.continue() : route.abort())
    const page = await context.newPage()
    for (const time of coarse ? auditedTimes : denseTimes) {
      await page.goto(`${origin}/b/${brId}?t=${time}`)
      const stage = page.locator('.replay-stage')
      const blan = stage.getByRole('button', { name: /^Blanchard2213(?: ·|$)/ })
      await blan.waitFor()
      await page.evaluate(() => document.fonts.ready)
      const fights = page.getByRole('button', { name: '关闭 此刻交火' })
      if (await fights.isVisible()) await fights.click()
      const grip = page.getByRole('separator', { name: '调整舞台高度' })
      const { x, y, width, height } = await grip.boundingBox()
      await page.mouse.move(x + width / 2, y + height / 2)
      await page.mouse.down()
      await page.mouse.move(x + width / 2, 1)
      await page.mouse.up()
      await page.mouse.move(0, 0)
      if (normalMotion) await page.waitForTimeout(400)
      await stabilize(page)
      check(await grip.getAttribute('aria-valuenow') === await grip.getAttribute('aria-valuemin'), `audit ${time} reaches minimum stage`)
      if (coarse) {
        const state = await measure(stage)
        const numala = state.ships.find(({ name }) => name.startsWith('Numala Airuta'))
        console.log('audit coarse minimum', time, JSON.stringify({ numala, chrome: state.chrome }))
        check(numala?.gridHit && numala.labelVisible && !numala.truncated, `audit ${time} Numala Airuta hull and entire name are visible`)
        await page.screenshot({ path: join(output, `audit-coarse-min-${time}.png`) })
      } else {
        for (const scale of [1.5, 2, 3]) {
          await zoomAt(page, stage, blan, scale)
          const state = await measure(stage)
          const unnamed = state.ships.filter((ship) => ship.inView && (!ship.labelVisible || ship.truncated))
          console.log('audit fine minimum', time, scale, JSON.stringify({ names: state.names, inView: state.inView,
            overlaps: state.overlaps, unnamed: unnamed.map(({ name }) => name) }))
          check(unnamed.length === 0 && state.overlaps === 0, `audit ${time} at ${scale}× names every in-view hull without overlap`)
          if (time === auditedTimes[0] && scale === 1.5) {
            const clareence = state.ships.find(({ name }) => name.startsWith('Clareence · Eris'))
            check(clareence?.hullFits && clareence.gridHit && clareence.labelVisible,
              'audit 16:04:54 at 150% shows Clareence’s Eris and its name')
            await page.screenshot({ path: join(output, 'audit-fine-min-150-clareence.png') })
          }
          if (unnamed.length > 0) await writeFile(join(output, `audit-fine-min-${time}-${scale}.json`), JSON.stringify(state, null, 2))
          zoomCount++
        }
      }
    }
    await context.close()
  }
  assert.deepEqual(failures, [], 'replay geometry acceptance')
  console.log(`Replay geometry passed in all ${samples.length} map cases and ${zoomCount} zooms.`)
} finally {
  await browser?.close()
  await server.close()
}
