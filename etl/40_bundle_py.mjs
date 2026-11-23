// Adapted from pyfa-phone (GPL-3.0-or-later).
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../', import.meta.url))
const data = join(root, 'public', 'fit-data')
const readJson = async (file) => JSON.parse(await readFile(join(root, 'build', file), 'utf8'))
const [game, pyodide] = await Promise.all([readJson('game-db.json'), readJson('pyodide.json')])
await Promise.all([
  access(join(data, game.db.file)),
  ...pyodide.files.map(({ file }) => access(join(root, 'public', file))),
])

const build = join(root, 'build')
const stage = await mkdtemp(join(build, 'fit-bundle-'))
const bundle = join(stage, 'engine.zip')
try {
  execFileSync('python3', ['-c', `
from pathlib import Path
from sys import argv
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

vendor = Path('vendor/pyfa')
vendor_files = [
    'config.py', 'LICENSE', 'eos/lgpl.txt', 'service/__init__.py',
    'service/character.py', 'service/const.py', 'service/damagePattern.py',
    'service/esi.py', 'service/esiAccess.py', 'service/fit.py',
    'service/market.py', 'service/server.py', 'service/settings.py',
    'service/port/__init__.py', 'service/port/eft.py',
    'service/port/muta.py', 'service/port/shared.py',
    'gui/__init__.py', 'gui/globalEvents.py',
    'gui/fitCommands/__init__.py', 'gui/fitCommands/helpers.py',
]
for directory in ('eos', 'service/conversions', 'service/jargon', 'utils'):
    vendor_files.extend(p.relative_to(vendor).as_posix() for p in (vendor / directory).rglob('*.py'))
vendor_files.extend(p.relative_to(vendor).as_posix() for p in (vendor / 'service/jargon').glob('*.yaml'))
files = {name: vendor / name for name in vendor_files}
own = Path('src/fit/py')
files.update({p.name: p for p in own.glob('*.py')})

with ZipFile(argv[1], 'w') as archive:
    for name, path in sorted(files.items()):
        archive.writestr(ZipInfo(name), path.read_bytes(), compress_type=ZIP_DEFLATED, compresslevel=9)
  `, bundle], { cwd: root, stdio: 'inherit' })

  const source = await readFile(bundle)
  const sha256 = createHash('sha256').update(source).digest('hex')
  const py = { file: `py.${sha256}.zip`, bytes: source.length, sha256 }
  const manifest = { ...game, py, pyodide }
  await mkdir(data, { recursive: true })
  await rename(bundle, join(data, py.file))
  const stagedManifest = join(stage, 'manifest.json')
  const manifestText = JSON.stringify(manifest, null, 2) + '\n'
  await writeFile(stagedManifest, manifestText)
  await rename(stagedManifest, join(data, 'manifest.json'))

  const total = game.db.bytes + py.bytes + Buffer.byteLength(manifestText) +
    pyodide.files.reduce((sum, asset) => sum + asset.bytes, 0)
  console.log(`Fit assets: ${total} bytes (${(total / 1024 ** 2).toFixed(2)} MiB) total, ${game.db.bytes} database and ${py.bytes} Python bundle`)
  // Keep the public asset tree limited to files referenced by the manifest.
  for (const file of await readdir(data)) {
    if (/^(?:eve\..*\.db\.gz|py\..*\.zip)$/.test(file) && file !== game.db.file && file !== py.file) {
      await rm(join(data, file))
    }
  }
} finally {
  await rm(stage, { recursive: true, force: true })
}
