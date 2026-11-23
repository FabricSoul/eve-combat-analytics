// Run with: node scripts/build-ui-fixture.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runnerImport } from 'vite'
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
  const { timeline } = analysis
  return {
    ...analysis,
    interactions: analysis.interactions.filter(({ t }) => start <= t && t <= end),
    ewarSpans: analysis.ewarSpans.filter((span) => span.start <= end && span.end >= start)
      .map((span) => ({ ...span, start: Math.max(span.start, start), end: Math.min(span.end, end) })),
    primaries: analysis.primaries.filter((span) => span.start <= end && span.end >= start)
      .map((span) => ({
        ...span,
        start: Math.max(span.start, start),
        end: Math.min(span.end, end),
        killedAt: span.killedAt !== null && start <= span.killedAt && span.killedAt <= end ? span.killedAt : null,
      })),
    timeline: {
      start,
      damageBySide: Object.fromEntries(Object.entries(timeline.damageBySide).map(([side, buckets]) => [
        side,
        Array.from({ length: (end - start) / 1000 + 1 }, (_, i) => buckets[(start - timeline.start) / 1000 + i] ?? 0),
      ])),
    },
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
const outputs = {
  'summary.json': summaryOf(state),
  'analysis.json': replayWindow(analyze(state)),
}
mkdirSync(directory, { recursive: true })
for (const [file, data] of Object.entries(outputs)) {
  const json = JSON.stringify(data) + '\n'
  const size = Buffer.byteLength(json)
  if (size >= 3_000_000) throw new Error(`${file} exceeds the 3 MB fixture limit (${size} bytes)`)
  writeFileSync(new URL(file, directory), json)
  console.log(`${file}: ${size} bytes`)
}
