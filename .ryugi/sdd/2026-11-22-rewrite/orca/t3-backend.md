# T3 — Worker + BattleRoom Durable Object (live battle backend)

{{COMMON}}

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
