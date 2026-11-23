// Adapted from pyfa-phone's Pyodide Worker (GPL-3.0-or-later).
import { expose } from 'comlink'
import type * as Pyodide from 'pyodide'
import { dependencies } from '../../package.json'
import type { FitWorkerApi, FitWorkerResult } from './client'
import { resolveEftItems, type EftItemKind } from './eft'
import packages from './runtime-packages.json'

interface EngineManifest {
  db: { file: string; encoding: 'gzip' }
  py: { file: string }
  pyodide: { version: string }
}

function localUrl(path: string, base: string | URL) {
  const url = new URL(path, base)
  if (url.origin !== self.location.origin) throw new Error('Fit assets must be hosted on the site origin')
  return url
}

async function fetchAsset(url: URL) {
  const response = await fetch(url, { redirect: 'error' })
  if (!response.ok) throw new Error(`Fit asset request failed (${response.status}): ${url.pathname}`)
  return response
}

async function installDatabase(runtime: Pyodide.PyodideInterface, database: Response, encoding: 'gzip') {
  if (!database.body) throw new Error('Fit database response has no body')
  // Some servers transparently decode the gzip with Content-Encoding.
  const [probe, data] = database.body.tee()
  const head = probe.getReader()
  const { value } = await head.read()
  void head.cancel().catch(() => {})
  const decoded = value?.[0] === 0x1f ? data.pipeThrough(new DecompressionStream(encoding)) : data

  const reader = decoded.getReader()
  const file = runtime.FS.open('/eve.db', 'w')
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      runtime.FS.write(file, chunk.value, 0, chunk.value.byteLength)
    }
  } finally {
    runtime.FS.close(file)
    await reader.cancel().catch(() => {})
  }
}

async function initialize() {
  const manifestUrl = localUrl(`${import.meta.env.BASE_URL}fit-data/manifest.json`, self.location.origin)
  const manifest: EngineManifest = await fetchAsset(manifestUrl).then((response) => response.json())
  const { version } = manifest.pyodide
  if (version !== dependencies.pyodide) throw new Error('Fit assets use an incompatible Pyodide version')
  const indexURL = localUrl(`../fit-runtime/${version}/`, manifestUrl).href
  const moduleUrl = localUrl('pyodide.mjs', indexURL).href
  const databaseUrl = localUrl(manifest.db.file, manifestUrl)
  const sourcesUrl = localUrl(manifest.py.file, manifestUrl)
  const [{ loadPyodide }, database, sources]: [typeof Pyodide, Response, ArrayBuffer] = await Promise.all([
    import(/* @vite-ignore */ moduleUrl),
    fetchAsset(databaseUrl),
    fetchAsset(sourcesUrl).then((response) => response.arrayBuffer()),
  ])
  const runtime = await loadPyodide({ indexURL, packages })
  await installDatabase(runtime, database, manifest.db.encoding)
  runtime.FS.writeFile('/pyfa.zip', new Uint8Array(sources))
  runtime.runPython(`
import sys
sys.path.insert(0, '/pyfa.zip')
import fit_stats
fit_stats.initialize('/eve.db')
`)
  return runtime
}

let startup: ReturnType<typeof initialize> | undefined
const getRuntime = () => (startup ??= initialize())

function callPython<T>(runtime: Pyodide.PyodideInterface, operation: 'load_item_kinds' | 'compute', payload: unknown): T {
  runtime.globals.set('_fit_payload', JSON.stringify(payload))
  try {
    return JSON.parse(runtime.runPython(`fit_stats.${operation}(_fit_payload)`))
  } finally {
    runtime.globals.delete('_fit_payload')
  }
}

expose({
  async ready() {
    await getRuntime()
  },
  async compute(fit) {
    const runtime = await getRuntime()
    const names = new Set(fit.stacks.flat().map(({ name }) => name))
    for (const { name, charge } of fit.modules) {
      names.add(name)
      if (charge !== undefined) names.add(charge)
    }
    const kinds = new Map(names.size
      ? callPython<[string, EftItemKind][]>(runtime, 'load_item_kinds', [...names])
      : [])
    const { parsed, drones, skippedLines } = resolveEftItems(fit, kinds)
    const result = callPython<FitWorkerResult>(runtime, 'compute', [parsed, drones])
    if (result.ok && skippedLines.length) result.stats.skippedLines = skippedLines
    return result
  },
} satisfies FitWorkerApi)
