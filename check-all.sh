#!/usr/bin/env bash
# Every gate. Any red exits non-zero.
set -euo pipefail
cd "$(dirname "$0")"
echo "▸ TypeScript"      && npx tsc --noEmit
echo "▸ Unit tests"      && npx vitest run
echo "▸ Workers tests"   && npx vitest run --config vitest.workers.config.ts
echo "▸ Production build" && npx vite build >/dev/null
echo
echo "All gates passed ✅"
