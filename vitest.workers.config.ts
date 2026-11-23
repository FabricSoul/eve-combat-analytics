import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'
import { realBattleState, realLogTexts } from './fixtures/real/j125990-20250622/load'
import { analyze } from './src/core/analysis/analyze'

const logs = realLogTexts()
const state = realBattleState()
const start = performance.now()
const expected = analyze(state)
const nodeMilliseconds = Math.round(performance.now() - start)
const jsonBytes = Buffer.byteLength(JSON.stringify(expected))

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/worker/test/entry.ts',
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          REAL_FIGHT_INFO: {
            meta: state.meta,
            names: state.names,
            listeners: state.logs.map(({ charId, charName, side }) => ({ charId, charName, side })),
            expected: { interactions: expected.interactions.length, jsonBytes, nodeMilliseconds },
          },
        },
        serviceBindings: {
          REAL_FIGHT_LOGS(request) {
            const index = Number(new URL(request.url).pathname.slice(1))
            return new Response(logs[index]?.text ?? null, { status: logs[index] ? 200 : 404 })
          },
        },
      },
    }),
  ],
  test: { include: ['src/worker/**/*.workers.spec.ts'] },
})
