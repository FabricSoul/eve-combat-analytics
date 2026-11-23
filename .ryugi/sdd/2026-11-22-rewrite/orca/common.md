## Project background (shared by every worker)

- Project: EVE Combat Analytics rewrite. Fleet-fight review for EVE Online. A battle is created from a br.evetools.org
  battle report (BR); pilots upload their in-game Gamelog files into it; everyone viewing the battle page sees new data
  live. No scores or ratings: every metric is data for side-by-side comparison between pilots.
- Repo: github.com/FabricSoul/eve-combat-analytics, branch `FabricSoul/revive` (the coordinator's worktree is
  /Users/fabric/orca/workspaces/eve-combat-analytics/revive). Orca created a child worktree for you from that branch.
- Read first: `AGENTS.md` (rules), `src/core/contract.ts` (the shared contract: types and function signatures every
  task implements against). Do not edit the contract. If it is wrong or missing something, ask the coordinator with
  `orca orchestration ask` and end your turn.
- Stack: TypeScript 7 strict + noUncheckedIndexedAccess, vitest 5, pnpm 12 (`pnpm install --frozen-lockfile` first),
  React 19 / Vite 8 (UI is NOT part of this batch), Cloudflare Worker + Durable Objects (SQLite backend).
- `src/core/**` runs in browser, Node and Workers: no DOM, no Node built-ins, no `cloudflare:*` imports there.
- Real data fixture: `fixtures/br/6b035d82a6d97f0534b7e73b.composition.json` (raw br.evetools composition JSON of a
  real fight: 5 Deklein systems, 2026-11-22 19:00–23:00 UTC, 55 killmails, 192 pilots) and `.names.json` (ESI names
  for every id in it). `src/core/br/normalize.ts` already turns it into `BattleMeta` — use it, don't rewrite it.
- Work test-first: write the failing test, run it and see it fail, then implement. Only edit the files your task lists.
  Commit on your branch, English messages prefixed with your task id (e.g. `T1: ...`). Do not push, do not merge.
- License GPL-3.0-or-later. Never copy code from repos without a compatible license (HenriFrancais/evebattlehistory,
  Peppe/EveDpsOverlay have none — reading them for format knowledge is fine, copying code is not).
- Outbound HTTP sends `User-Agent: eve-combat-analytics (+https://github.com/FabricSoul/eve-combat-analytics)`.
  Tests never hit the network: inject `fetch`.
- Done means `./check-all.sh` passes on your branch. Report with worker_done: commit SHA(s), the verification commands
  you ran with the tail of their output, and every decision the spec did not cover (one line each: decision — reason).
