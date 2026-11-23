import { readdir, readFile, stat } from 'node:fs/promises'

const client = new URL('../dist/client/', import.meta.url)
const manifest = JSON.parse(await readFile(new URL('.vite/manifest.json', client), 'utf8'))
const files = (await readdir(new URL('assets/', client))).filter((file) => file.endsWith('.js')).sort()
if (files.length === 0) throw new Error('No client JavaScript assets found')

const sizes = new Map(await Promise.all(files.map(async (file) => {
  const path = `assets/${file}`
  return [path, (await stat(new URL(path, client))).size]
})))
const maxChunk = 500_000
const maxHome = 350_000
const entry = 'index.html'
if (!manifest[entry]?.isEntry) throw new Error(`Client manifest is missing its ${entry} entry`)

const visited = new Set()
const initial = new Set()

function visit(key) {
  if (visited.has(key)) return
  visited.add(key)
  const chunk = manifest[key]
  if (!chunk || !sizes.has(chunk.file)) throw new Error(`Missing client JavaScript for manifest entry ${key}`)
  initial.add(chunk.file)
  for (const dependency of chunk.imports ?? []) visit(dependency)
}
visit(entry)

const homeBytes = [...initial].reduce((total, file) => total + sizes.get(file), 0)
const kb = (bytes) => `${(bytes / 1000).toFixed(2)} kB`
const errors = []
for (const [file, size] of sizes) {
  console.log(`${kb(size).padStart(11)}  ${file}${initial.has(file) ? ' (home)' : ''}`)
  if (size > maxChunk) errors.push(`${file} is ${kb(size)}, above the ${kb(maxChunk)} client chunk limit`)
}
console.log(`${kb(homeBytes)} home initial JavaScript across ${initial.size} chunk(s) (raw)`)
if (homeBytes > maxHome) errors.push(`Home initial JavaScript is ${kb(homeBytes)}, above the ${kb(maxHome)} limit`)
for (const error of errors) console.error(error)
if (errors.length > 0) process.exitCode = 1
