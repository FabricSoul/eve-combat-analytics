#!/usr/bin/env bash
# Every gate. Any red exits non-zero.
set -euo pipefail
cd "$(dirname "$0")"
echo "▸ TypeScript"      && npx tsc --noEmit
echo "▸ Unit tests"      && npx vitest run
echo "  (timing benchmarks run only with PERF=1; this host is often at load 50–200)"
echo "▸ Workers tests"   && npx vitest run --config vitest.workers.config.ts
echo "▸ Fit assets"       && pnpm fit:assets
echo "▸ Fit parity"       && node etl/parity/browser.mjs
echo "▸ Production build" && npx vite build >/dev/null
if [[ "${UI_SMOKE:-${PERF:-0}}" == 1 ]]; then
  echo "▸ UI smoke" && node scripts/ui-smoke.mjs
fi
echo
echo "All gates passed ✅"
