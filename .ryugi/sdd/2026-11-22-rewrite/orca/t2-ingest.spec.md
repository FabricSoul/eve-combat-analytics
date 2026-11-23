# T2 — BR fetch + ESI lookups

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
The pieces the backend uses to (a) turn a pasted BR link into a full `BattleMeta`, and (b) turn character names seen
in Gamelogs into character ids and sides. All functions take an injected `fetch` (type `typeof fetch`) and never
touch the network in tests.

## You may edit
`src/core/br/url.ts`, `src/core/br/fetch.ts`, `src/core/esi/**`, and their `*.test.ts`. Do not edit
`src/core/br/normalize.ts` (already done; import `normalizeBrComposition` and `sideOf` from it).

## Build
1. `src/core/br/url.ts` — `parseBrUrl: ParseBrUrl`. Accept `https://br.evetools.org/br/<24 hex>` with or without
   `www.`, trailing slash, query (`?tab=…`) or fragment, surrounding whitespace, and a bare 24-hex id. Everything else
   → `null` (including `/related/...` and `/battle/...` links — those are a later feature).
2. `src/core/esi/client.ts` — a tiny ESI client: base `https://esi.evetech.net/latest`, `datasource=tranquility`,
   the User-Agent from AGENTS.md, JSON in/out. Respect ESI's error limit: if a response has
   `X-ESI-Error-Limit-Remain` < 10, wait `X-ESI-Error-Limit-Reset` seconds before the next call (sleep is injected).
   Retry 502/503/504 twice with backoff. Throw a typed error otherwise.
3. `src/core/esi/names.ts`:
   - `idsToNames(ids, deps)` → `BattleMeta['names']` via `POST /universe/names/`, chunks of ≤1000, de-duplicated.
     ESI rejects the whole chunk with 404 if any id is invalid: on 404 split the chunk in halves recursively and drop
     the single bad ids.
   - `namesToCharacters(names, deps)` → `Record<string, number | null>` via `POST /universe/ids/` (chunks of ≤500;
     only the `characters` array counts; ESI matches names case-insensitively but returns the canonical name —
     key the result by the input string). Unknown names → null.
   - `affiliations(charIds, deps)` → `Affiliation[]` via `POST /characters/affiliation/`, chunks of ≤1000.
4. `src/core/br/fetch.ts` — `fetchBattleMeta(brId, deps)`:
   - `GET https://br.evetools.org/newapi/br/composition/<brId>`. While the body says `status: "processing"`, retry
     every 2 s up to 30 s (sleep injected), then fail `br_unavailable`. 404 or an empty/invalid body →
     `br_not_found`; network errors / 5xx → `br_unavailable`. Errors are thrown as an `ApiFailure` class carrying an
     `ApiErrorCode` (export it from `src/core/esi/client.ts` or a small `src/core/br/errors.ts` — you choose, say which).
   - Collect every id in teams and killmails (chars, corps, alliances, ship and weapon types), call `idsToNames`,
     then `normalizeBrComposition(raw, names, now())`.
5. `src/core/esi/side.ts` — `sideForCharacter(aff: Affiliation, teams)` → number, delegating to `sideOf`.

## Failing tests to write first
- `parseBrUrl`: every accepted shape, and at least six rejected ones.
- `fetchBattleMeta` with a fake fetch that serves `fixtures/br/6b035d82a6d97f0534b7e73b.composition.json` and answers
  `/universe/names/` from `.names.json`: the result has 55 killmails, 5 windows and `names[22456].name === 'Sabre'`;
  the processing-then-success path; 404 → `br_not_found`; 500 three times → `br_unavailable`.
- `idsToNames` splits on 404 and drops only the bad id; chunking at 1000.
- `namesToCharacters`: case-insensitive match keyed by the input, unknown → null, chunking at 500.
- ESI error-limit wait and 5xx retry, using an injected sleep that records its calls.
- Every request carries the User-Agent.

## Evidence for worker_done
`./check-all.sh` tail; the list of tests; the error class you chose and where it lives.

Placement: this machine (local), the user named it.
