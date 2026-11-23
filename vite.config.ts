/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import { fileURLToPath, URL } from 'node:url'

const workerEnvironment = 'eve_combat_analytics'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), ...(mode === 'test' ? [] : [cloudflare({ viteEnvironment: { name: workerEnvironment } })])],
  environments: mode === 'test' ? undefined : {
    client: { build: { manifest: true } },
    // The Worker bundle executes server-side and has its own size budget.
    [workerEnvironment]: { build: { chunkSizeWarningLimit: 600 } },
  },
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  test: { environment: 'node', include: ['src/**/*.test.{ts,tsx}'] },
}))
