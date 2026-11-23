// Adapted from pyfa-phone's etl/parity/browser_local.mjs (GPL-3.0-or-later).
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from 'playwright-core'
import { build } from 'vite'

const root = fileURLToPath(new URL('../../', import.meta.url))
await mkdir(join(root, 'build'), { recursive: true })
const temp = await mkdtemp(join(root, 'build', 'fit-parity-'))
const output = join(temp, 'site')
const entry = join(temp, 'index.html')
const mime = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.wasm': 'application/wasm', '.json': 'application/json',
}

const server = createServer(async (request, response) => {
  try {
    const pathname = new URL(request.url, 'http://localhost').pathname
    const file = resolve(output, '.' + pathname)
    assert.ok(!relative(output, file).startsWith('..'))
    const content = await readFile(file)
    response.writeHead(200, { 'content-type': mime[extname(file)] ?? 'application/octet-stream' }).end(content)
  } catch {
    response.writeHead(404).end()
  }
})

const fixtures = ['hurricane', 'oracle', 'scimitar']
let rows = 0

function compare(expected, actual, fit, fields = []) {
  if (typeof expected === 'number') {
    const field = fields.join('.')
    assert.ok(Number.isFinite(actual) && Math.abs(expected - actual) <= 0.01,
      `${fit} ${field}: CPython ${expected}, browser ${actual}`)
    console.log(`| ${fit} | ${field} | ${expected.toFixed(4)} | ${actual.toFixed(4)} |`)
    rows++
  } else if (typeof expected === 'object') {
    assert.deepEqual(Object.keys(actual).sort(), Object.keys(expected).sort(), `${fit} ${fields.join('.')}`)
    for (const [name, value] of Object.entries(expected)) compare(value, actual[name], fit, [...fields, name])
  } else {
    assert.equal(actual, expected, fields.join('.'))
  }
}

let browser
try {
  await writeFile(entry, `<!doctype html><script type="module">
    import { computeFitStats, EftFormatError } from '/src/fit/client.ts'
    window.computeFitStats = computeFitStats
    window.eftErrorCode = async (eft) => {
      try { await computeFitStats(eft) }
      catch (error) { if (error instanceof EftFormatError) return error.code; throw error }
    }
  </script>`)
  await build({ root, configFile: false, logLevel: 'error', worker: { format: 'es' },
    build: { outDir: output, rollupOptions: { input: entry } } })

  const executablePath = [
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE, chromium.executablePath(),
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium',
  ].find((candidate) => candidate && existsSync(candidate))
  if (!executablePath) throw new Error('Chromium is missing. Run pnpm exec playwright-core install chromium.')
  browser = await chromium.launch({ executablePath, headless: true })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  const origin = `http://127.0.0.1:${server.address().port}`
  const context = await browser.newContext({ serviceWorkers: 'block' })
  const external = []
  const requests = []
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== origin) {
      external.push(url.href)
      return route.abort()
    }
    requests.push(url.pathname)
    return route.continue()
  })
  const page = await context.newPage()
  await page.goto(`${origin}/${relative(root, entry)}`)
  await page.waitForFunction(() => typeof window.computeFitStats === 'function')
  const engineAssets = () => requests.filter((path) => /\/fit-(?:data|runtime)\/|engine\.worker/.test(path))
  assert.deepEqual(engineAssets(), [], 'Importing the client must not load the Worker')
  assert.equal(await page.evaluate(() => window.eftErrorCode('not an EFT fit')), 'bad_eft')
  assert.deepEqual(engineAssets(), [], 'Malformed EFT must not start the Worker')

  const eft = await Promise.all(fixtures.map((name) => readFile(join(root, `etl/parity/${name}.eft`), 'utf8')))
  const { result, coldMs } = await page.evaluate(async ([first, ...warm]) => {
    const start = performance.now()
    const firstResult = await window.computeFitStats(first)
    const coldMs = performance.now() - start
    return { coldMs, result: [firstResult, ...await Promise.all(warm.map(window.computeFitStats))] }
  }, eft)
  assert.equal(await page.evaluate(() => window.eftErrorCode('[Oracle, Bad charge]\nMega Pulse Laser II, Nothing')), 'bad_eft')
  assert.deepEqual(await page.evaluate((input) => window.computeFitStats(input), eft[0]), result[0])
  assert.deepEqual(external, [], 'Chromium attempted an off-origin request')
  assert.equal(requests.filter((path) => path.endsWith('/pyodide.mjs')).length, 1)
  assert.equal(requests.filter((path) => path.endsWith('.db.gz')).length, 1)

  // An asset manifest can never direct the Worker to an off-origin database.
  // Reload to force startup and let the next call retry with the real manifest.
  await context.route('**/fit-data/manifest.json', async (route) => {
    const manifest = JSON.parse(await readFile(join(output, 'fit-data', 'manifest.json'), 'utf8'))
    manifest.db.file = 'https://example.invalid/eve.db.gz'
    await route.fulfill({ json: manifest })
  }, { times: 1 })
  await page.reload()
  await page.waitForFunction(() => typeof window.computeFitStats === 'function')
  await assert.rejects(page.evaluate((input) => window.computeFitStats(input), eft[0]), /site origin/)
  assert.deepEqual(await page.evaluate((input) => window.computeFitStats(input), eft[0]), result[0])
  assert.deepEqual(external, [], 'Chromium attempted an off-origin request')

  const expected = JSON.parse(execFileSync('uv', [
    'run', '--python', '3.13', '--with', 'sqlalchemy==2.0.51', '--with', 'logbook==1.9.2',
    '--with', 'pyyaml', '--with', 'cryptography', 'python', 'etl/parity/reference.py', ...fixtures,
  ], { cwd: root, encoding: 'utf8' }))
  assert.ok(expected.hurricane.dps.turret > 0 && expected.hurricane.dps.missile > 0 && expected.hurricane.dps.drone > 0)
  assert.ok(expected.oracle.ranges['Mega Pulse Laser II'].optimal > 0 && expected.scimitar.remoteRepair.shield > 0)

  console.log('| Fit | Field | CPython | Chromium |')
  console.log('| --- | --- | ---: | ---: |')
  fixtures.forEach((name, i) => compare(expected[name], result[i], expected[name].shipTypeName))
  console.log(`Chromium parity passed for ${rows} fields across ${fixtures.length} fits (tolerance 0.01)`)
  console.log(`First computeFitStats: ${coldMs.toFixed(0)} ms with a fresh Chromium context`)
  console.log('Asset checks passed: lazy startup, one data load, rejected off-origin manifest, successful retry, zero off-origin requests')
} finally {
  await browser?.close()
  if (server.listening) await new Promise((done) => server.close(done))
  await rm(temp, { recursive: true, force: true })
}
