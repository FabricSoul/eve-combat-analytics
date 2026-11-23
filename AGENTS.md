# EVE Combat Analytics — rules for every agent

Fleet-fight review for EVE Online. A battle is created from a br.evetools.org battle report; pilots upload their
Gamelogs into it; everyone viewing sees new data live. No scores: every metric is data for side-by-side comparison.

- Stack: TypeScript (strict, noUncheckedIndexedAccess) · React 19 + Vite 8 + Tailwind 4 (UI, built after the design is approved) ·
  Cloudflare Worker + Durable Objects (SQLite) for the backend · vitest · pnpm 12.
- `src/core/contract.ts` is the shared contract. Do not edit it; if it is wrong or missing something, ask the coordinator.
- `src/core/**` must run in browser, Node and Workers: no DOM, no Node built-ins, no `cloudflare:*` imports.
- Real data: `fixtures/br/6b035d82a6d97f0534b7e73b.*.json` (a real BR: 5 systems, 55 killmails, 192 pilots, plus ESI names).
  Never invent numbers in fixtures without saying so in the fixture's header comment.
- Gate: `./check-all.sh` must pass before you report done. Run it on zion, not on this Mac (load 50–200 here):
  `scripts/check-remote.sh` syncs your working tree to zion and runs the full gate with PERF=1 in about a minute.
- Work test-first (write the failing test, watch it fail, then implement). Only edit the files your task lists.
  Commit on your branch with English messages prefixed by the task id. Do not push, do not merge.
- License: GPL-3.0-or-later. Do not copy code from repositories without a compatible license (for example
  HenriFrancais/evebattlehistory and Peppe/EveDpsOverlay have no license: read them for format knowledge only).
- Outbound HTTP (ESI, zKillboard, br.evetools.org) sends `User-Agent: eve-combat-analytics (+https://github.com/FabricSoul/eve-combat-analytics)`.
