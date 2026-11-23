// Run with: node scripts/build-ui-fixture.ts
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'
import { exportPilotSeries } from '../etl/export-u7-pilot-data.mjs'
import type { Analysis, Analyze, BattleState, BattleSummary } from '../src/core/contract'

const root = new URL('../', import.meta.url)
const directory = new URL('fixtures/real/j125990-20250622/ui/', root)
const start = Date.parse('2025-06-22T15:41:30Z')
const end = Date.parse('2025-06-22T15:44:30Z')

function summaryOf({ logs, ...state }: BattleState): BattleSummary {
  return {
    ...state,
    analysisVersion: 1,
    logs: logs.map(({ id, charId, charName, side, uploadedAt, parsed }) => ({
      id, charId, charName, side, uploadedAt,
      events: parsed.events.length,
      first: parsed.events[0]?.t,
      last: parsed.events.at(-1)?.t,
      language: parsed.language,
    })),
  }
}

function replayWindow(analysis: Analysis): Analysis {
  return {
    ...analysis,
    interactions: analysis.interactions.filter(({ t }) => start <= t && t <= end),
    ewarSpans: analysis.ewarSpans.filter((span) => span.start <= end && span.end >= start)
      .map((span) => ({ ...span, start: Math.max(span.start, start), end: Math.min(span.end, end) })),
  }
}

// Vite resolves the same extensionless TypeScript and JSON imports used by the app.
async function load<T>(path: string): Promise<T> {
  const { module } = await runnerImport<T>(fileURLToPath(new URL(path, root)), { root: fileURLToPath(root), configFile: false })
  return module
}

const [{ realBattleStateWithBr }, { analyze }] = await Promise.all([
  load<{ realBattleStateWithBr(): BattleState }>('fixtures/real/j125990-20250622/load.ts'),
  load<{ analyze: Analyze }>('src/core/analysis/analyze.ts'),
])

const state = realBattleStateWithBr()
const analysis = analyze(state)
const outputs = {
  'summary.json': summaryOf(state),
  'analysis.json': { ...replayWindow(analysis), replayStart: start, pilotSeries: exportPilotSeries(analysis) },
}
mkdirSync(directory, { recursive: true })
const encoded = Object.entries(outputs).map(([file, data]) => {
  const json = JSON.stringify(data) + '\n'
  return { file, json, size: Buffer.byteLength(json) }
})
const totalBytes = encoded.reduce((total, { size }) => total + size, 0)
// The gallery also includes a recorded EFT and pyfa output for one real fit.
const fitBytes = statSync(new URL('src/app/gallery/sections/u7-fit-data.json', root)).size
if (totalBytes + fitBytes > 3_000_000) throw new Error(`Gallery data exceeds 3 MB (${totalBytes + fitBytes} bytes)`)
for (const { file, json, size } of encoded) {
  writeFileSync(new URL(file, directory), json)
  console.log(`${file}: ${size} bytes`)
}
