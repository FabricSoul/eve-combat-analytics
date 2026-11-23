#!/usr/bin/env bash
# Run ./check-all.sh (with PERF=1) on a remote Linux host. The local Mac is often at load 50-200.
# Usage: scripts/check-remote.sh [host]   (default: zion). Syncs the working tree, not git history.
set -euo pipefail
cd "$(dirname "$0")/.."
host="${1:-${CHECK_HOST:-zion}}"
name="$(basename "$PWD")-$(git rev-parse --abbrev-ref HEAD | tr '/' '-')"
dest="ci/eve-combat-analytics/$name"
echo "▸ Sync to $host:~/$dest"
ssh "$host" "mkdir -p ~/$dest"
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude .wrangler --exclude build --exclude public/pyfa \
  --exclude 'fixtures/local/' --exclude '.ryugi/artifacts/' --exclude '.git/' --exclude 'vendor/pyfa/' --exclude '.venv/' --exclude '__pycache__/' \
  ./ "$host:~/$dest/"
pyfa_sha="$(git ls-tree HEAD vendor/pyfa | awk '{print $3}')"
echo "▸ pyfa $pyfa_sha on $host"
ssh "$host" "set -e; c=~/ci/pyfa-cache; if [ ! -d \$c/.git ]; then git clone -q --filter=blob:none https://github.com/pyfa-org/Pyfa.git \$c; fi; cd \$c; git cat-file -e $pyfa_sha 2>/dev/null || git fetch -q --depth 1 origin $pyfa_sha; git checkout -q --force $pyfa_sha; git clean -qfdx; mkdir -p ~/$dest/vendor; rm -rf ~/$dest/vendor/pyfa; ln -s \$c ~/$dest/vendor/pyfa"
echo "▸ Run on $host"
# On NixOS hosts Playwright's bundled Chromium lacks system libraries: use nixpkgs' chromium when nix exists.
ssh "$host" "cd ~/$dest && export CI=1 PERF=1 && if command -v nix >/dev/null; then export PLAYWRIGHT_CHROMIUM_EXECUTABLE=\$(nix --extra-experimental-features 'nix-command flakes' build nixpkgs#chromium --no-link --print-out-paths)/bin/chromium; fi && pnpm install --frozen-lockfile --reporter=silent && ./check-all.sh"
