// Adapted from pyfa-phone (GPL-3.0-or-later).
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import packages from '../src/fit/runtime-packages.json' with { type: 'json' }

const root = fileURLToPath(new URL('../', import.meta.url))
const moduleDir = dirname(fileURLToPath(import.meta.resolve('pyodide')))
const pkg = JSON.parse(await readFile(join(moduleDir, 'package.json'), 'utf8'))
const app = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const lock = JSON.parse(await readFile(join(moduleDir, 'pyodide-lock.json'), 'utf8'))
const version = app.dependencies.pyodide
if (version !== pkg.version) {
  throw new Error(`Installed Pyodide must match the exact version ${version}`)
}

const runtimeFiles = ['pyodide.mjs', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']
const wheels = new Map()
function includePackage(name) {
  const item = lock.packages[name]
  if (!item?.file_name || !item.sha256 || basename(item.file_name) !== item.file_name) {
    throw new Error(`Pyodide's lock has no local package entry for ${name}`)
  }
  if (wheels.has(item.file_name)) return
  wheels.set(item.file_name, item.sha256)
  for (const dep of item.depends) includePackage(dep)
}
for (const name of packages) includePackage(name)

const dir = join(root, 'public', 'fit-runtime', version)
const build = join(root, 'build')
await Promise.all([mkdir(dir, { recursive: true }), mkdir(build, { recursive: true })])
const digest = (data) => createHash('sha256').update(data).digest('hex')
const maxBytes = 25 * 1024 * 1024

async function optionalRead(path) {
  try {
    return await readFile(path)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    return undefined
  }
}

async function lockedWheel(name, sha256) {
  const locations = [dir, moduleDir, join(root, 'node_modules/.cache/pyodide')]
  for (const directory of locations) {
    const data = await optionalRead(join(directory, name))
    if (data && digest(data) === sha256) return data
  }
  // Pyodide distributes the wheels absent from npm via its versioned release CDN.
  // This URL is used by ETL only. The application serves the verified files locally.
  const response = await fetch(`https://cdn.jsdelivr.net/pyodide/v${version}/full/${name}`, {
    headers: { 'User-Agent': 'eve-combat-analytics (+https://github.com/FabricSoul/eve-combat-analytics)' },
  })
  if (!response.ok) throw new Error(`Pyodide release download failed for ${name}: ${response.status}`)
  const data = Buffer.from(await response.arrayBuffer())
  if (digest(data) !== sha256) throw new Error(`Pyodide lock checksum mismatch for ${name}`)
  return data
}

async function publish(name, data) {
  if (data.length >= maxBytes) throw new Error(`${name} exceeds the Cloudflare 25 MiB file limit`)
  const output = join(dir, name)
  const staged = `${output}.${process.pid}.tmp`
  await writeFile(staged, data)
  await rename(staged, output)
  return { file: `fit-runtime/${version}/${name}`, bytes: data.length, sha256: digest(data) }
}

const runtime = runtimeFiles.map(async (name) => {
  let data = await readFile(join(moduleDir, name))
  if (name === 'pyodide.mjs') {
    // The npm loader hard-codes a Node-only download fallback. Reuse the
    // configured index URL so this vendored loader is also local in Node.
    const source = data.toString()
    const local = source.replace(/\x60https:\/\/cdn\.jsdelivr\.net\/pyodide\/v\$\{[\w$]+\}\/full\/\x60/, 't')
      .replace(/^\/\/# sourceMappingURL=.*$/m, '')
    if (local === source || local.includes('cdn.jsdelivr.net')) {
      throw new Error('Pyodide loader fallback changed; inspect the pinned release')
    }
    data = Buffer.from(local)
  }
  return publish(name, data)
})
const dependencies = [...wheels].map(async ([name, sha]) => publish(name, await lockedWheel(name, sha)))
const files = (await Promise.all([...runtime, ...dependencies])).sort((a, b) => a.file.localeCompare(b.file, 'en'))
const metadata = join(build, 'pyodide.json')
const stagedMetadata = `${metadata}.${process.pid}.tmp`
await writeFile(stagedMetadata, JSON.stringify({ version, files }) + '\n')
await rename(stagedMetadata, metadata)
const total = files.reduce((bytes, file) => bytes + file.bytes, 0)
const largest = files.reduce((max, file) => file.bytes > max.bytes ? file : max)
console.log(`Pyodide ${version}: ${files.length} files, ${total} bytes, largest ${basename(largest.file)} (${largest.bytes} bytes)`)
