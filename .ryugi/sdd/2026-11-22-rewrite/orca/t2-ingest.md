# T2 — BR fetch + ESI lookups

{{COMMON}}

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
