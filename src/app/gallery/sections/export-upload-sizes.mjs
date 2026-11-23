// node src/app/gallery/sections/export-upload-sizes.mjs
// Real decompressed byte counts of the checked-in J125990 Gamelogs, for the upload gallery rows.
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { gunzipSync } from 'node:zlib'

const dir = new URL('../../../../fixtures/real/j125990-20250622/logs/', import.meta.url)
const sizes = Object.fromEntries(readdirSync(dir).filter((f) => f.endsWith('.txt.gz')).sort()
  .map((f) => [f.replace(/\.gz$/, ''), gunzipSync(readFileSync(new URL(f, dir))).length]))
writeFileSync(new URL('./upload-log-sizes.json', import.meta.url), JSON.stringify(sizes, null, 1) + '\n')
