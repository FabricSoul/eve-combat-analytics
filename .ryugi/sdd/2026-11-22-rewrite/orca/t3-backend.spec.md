# T3 — Worker + BattleRoom Durable Object (live battle backend)

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


## Goal
The Cloudflare backend: the HTTP + WebSocket API described in `src/core/contract.ts` ("HTTP + WebSocket API"), with
one `BattleRoom` Durable Object per battle (id = `idFromName(brId)`), state in the DO's SQLite storage, and live
broadcast to every connected viewer using the WebSocket Hibernation API (`ctx.acceptWebSocket`,
`webSocketMessage`/`webSocketClose`, `getWebSockets()` for broadcast).

## Dependencies are injected
The parser (T1) and the BR/ESI functions (T2) are being written in parallel. Do not import them. Define in
`src/worker/services.ts`:
```ts
export interface Services {
  parseGamelog: ParseGamelog
  fetchBattleMeta(brId: string): Promise<BattleMeta>   // throws an error with .code: ApiErrorCode
  namesToCharacters(names: string[]): Promise<Record<string, number | null>>
  affiliations(charIds: number[]): Promise<Affiliation[]>
  now(): number
}
```
and a `createServices(env)` that for now throws "not wired" — the coordinator wires the real ones after T1/T2 land.
`BattleRoom` and the router get `Services` through a factory you can replace in tests.

## You may edit
`src/worker/**`, `wrangler.jsonc` (bindings only), `vite.config.ts` / a new `vitest.workers.config.ts`,
`package.json` + `pnpm-lock.yaml` (only to add `@cloudflare/vitest-pool-workers` or what Workers testing needs),
`check-all.sh` (add one line that runs the Workers tests). Nothing in `src/core/`.

## Behaviour
- `POST /api/battles` `{ brUrl }`: parse the id (a local copy of the id regex is fine: 24 hex after `/br/`, or a bare
  id — T2's `parseBrUrl` replaces it later), `bad_br_url` otherwise. The DO fetches the BR once via
  `services.fetchBattleMeta` and stores it; a second call for the same brId returns `{ brId }` without refetching.
- `GET /api/battles/:brId` → `BattleState` (404 `br_not_found` if never created).
- `POST /api/battles/:brId/logs`, body = raw Gamelog text (`text/plain`), max 10 MB → `too_large`:
  1. `parseGamelog` (its `GamelogFormatError` → `not_a_gamelog`).
  2. Keep only events whose `t` falls inside one of `meta.windows` (inclusive). None left → `no_overlap`.
  3. Listener name → charId (`namesToCharacters`) → `affiliations` → side via the teams (`ally:` first, then
     `corp:`), -1 if none. Unknown character → `unknown_character`. Do NOT require the character to appear on a
     killmail (logistics pilots who neither killed nor died are not on the BR).
  4. `id` = sha256 hex of the text (WebCrypto). Same id already stored → return the summary, `replaced: false`, no
     broadcast. Same charId with a different id → replace, `replaced: true`.
  5. Resolve every new counterparty display name (`other.name`, falling back to `raw`) that is not yet in the battle's
     `NameIndex`: `namesToCharacters` (batch) then `affiliations` for the hits; NPCs and misses become `null`.
  6. Store, then broadcast `{ type: 'log_added', log, names }` (names = only the newly resolved entries).
- `PUT /api/battles/:brId/fits/:charId`, body = EFT text: store as `FitEntry` (validate only that the first line looks
  like `[Ship, Name]`, else `bad_eft`), broadcast `fit_set`.
- `GET /api/battles/:brId/ws`: WebSocket upgrade; on connect send `{ type: 'snapshot', state }`.
- Storage: SQLite tables in the DO (meta JSON, logs JSON one row per charId, fits, names). A DO SQLite value is
  limited to 2 MB: store `ParsedLog` compressed (`CompressionStream('gzip')`) or chunked so a 3,000-event log fits.
- Errors are `ApiError` JSON with sensible status codes. CORS: same-origin only (no headers needed).
- The static UI is served by Workers assets (already configured); `/api/*` runs the Worker first.

## Failing tests to write first
Use `@cloudflare/vitest-pool-workers` (or Miniflare) so the DO, its SQLite storage and WebSockets run for real:
create → idempotent create; GET state; upload happy path with fake services (side assignment, window trimming, name
resolution batching); every error code; re-upload same file → no-op; newer log for the same character replaces;
two WebSocket clients both receive `log_added` after an upload and a new client receives the snapshot; a 3,000-event
log round-trips through storage; fit set + broadcast.

## Evidence for worker_done
`./check-all.sh` tail (including the Workers tests); how logs are stored and the measured stored size of a 3,000-event
log; anything in the API you had to interpret.

Placement: this machine (local), the user named it.
