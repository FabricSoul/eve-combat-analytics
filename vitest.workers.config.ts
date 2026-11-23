import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      main: './src/worker/test/entry.ts',
      wrangler: { configPath: './wrangler.jsonc' },
    }),
  ],
  test: { include: ['src/worker/**/*.workers.spec.ts'] },
})
