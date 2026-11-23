# T4 — Analysis engine (`analyze`)

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
Implement `analyze: Analyze` from `src/core/contract.ts` in `src/core/analysis/`: a pure function from a
`BattleState` (BR meta + every uploaded `ParsedLog` + name index + fits) to an `Analysis` the UI draws: the
deduplicated interaction stream that drives the replay, ewar spans, primary targets, per-pilot comparison stats,
coverage, and the per-side damage timeline. It runs in the browser on every live update, so it must be fast.

## You may edit
`src/core/analysis/**` (split into modules as you like: entities, interactions/dedupe, ewar spans, primaries, stats,
timeline) and `fixtures/states/**` for hand-built states. Nothing else.

## Definitions (implement exactly; if one is unworkable, ask the coordinator)
- **Entities.** Every log listener (`char:<id>` from `UploadedLog.charId`), every counterparty (resolved through
  `state.names[displayName]` to `char:<id>` with that side, else `name:<displayName>` with side -1, where
  displayName = `other.name ?? other.raw`), and every killmail participant with a charId (name from `meta.names`,
  side via `sideOf` from `src/core/br/normalize.ts`, ship from `meta.names[shipTypeId]`). `shipTypes` collects every
  ship seen for the entity (log counterparty ship labels and killmail ships), de-duplicated. `hasLog` = has an
  uploaded log.
- **Interactions.** Each log event becomes one interaction: for `dir: 'out'` from = listener, to = counterparty; for
  `'in'` the reverse. Kinds map 1:1 (`repair` keeps `repairType`, `ewar` keeps `ewar`).
- **Dedupe.** The same hit appears in both parties' logs when both uploaded. Two interactions from different logs are
  the same when from, to, kind, amount are equal, the weapon/module is equal or either is null, and |Δt| ≤ 1 s. Merge
  into one with both `sources` and `corroborated: true`; keep the earlier t. Match greedily in time order so a burst of
  equal hits pairs one-to-one (never one-to-many). Misses dedupe the same way with amount 0.
- **Ewar spans.** Warp scramble/disrupt (and other ewar) lines repeat while the effect holds. Consecutive lines for the
  same from/to/ewar less than 15 s apart form one span [first t, last t + 5 s].
- **Engagement time** of an entity: from its first to its last interaction (any kind, either direction).
- **Primary target** per side, computed on 10 s windows sliding by 1 s: the enemy entity receiving the most damage
  from that side in the window, if it received ≥ 40% of the side's damage in that window and ≥ 2 distinct shooters
  hit it. Consecutive windows with the same primary merge into one `PrimaryTarget` span; gaps < 5 s are bridged.
  `killedAt` = the killmail time of that target (victim charId match) if it falls within span end + 10 s; `damage`
  and `shooters` are over the span.
- **PilotStats** for every entity with a log, plus killmail-only entities (log-derived fields 0/null for those):
  - `damageOut/In`, `repairOut/In`, `neutOut/In`: sums over deduplicated interactions.
  - `activeRatio`: distinct seconds with outgoing damage ÷ engagement seconds (0 when engagement is 0).
  - `primaryShare`: outgoing damage that hit the side's primary of that second ÷ damageOut.
  - `switchDelayMedian`: for each primary span of the pilot's side after the first, seconds from span start to the
    pilot's first hit on that target within the span; median over spans where it hit at all; null if none.
  - `repReactionMedian`: for each friendly the pilot repaired, each "damage episode" (incoming damage after ≥ 10 s
    without any) → seconds to the pilot's first repair on that friendly within 30 s; median; null if none.
  - `firstShotDelay`: pilot's first outgoing damage minus the side's first outgoing damage.
  - `hitQuality`: counts by quality of outgoing damage; `misses`: outgoing misses.
  - `pointSeconds`: total length of outgoing warp_scramble/warp_disrupt spans.
  - `killmailDamage` / `killmailCount`: sum of the entity's attacker damage on killmails / number of killmails it is on.
- **Coverage** per side: `known` = distinct characters of that side seen in killmails or logs, `withLog` = those with an
  uploaded log.
- **Timeline**: `start` = first interaction t floored to the second; `damageBySide[s][i]` = damage dealt by side s in
  second i (deduplicated). Empty state → start = first killmail t, empty arrays.

## Failing tests to write first
- Hand-built small states in `fixtures/states/` (say in a header that they are synthetic) with exact expected outputs:
  dedupe of a two-sided exchange (corroborated, one-to-one with bursts of equal hits, weapon null on one side), ewar span
  merging, primary detection (threshold edges: 39% vs 40%, one shooter vs two, gap bridging, killedAt), each PilotStats
  field, coverage, timeline buckets.
- On the real BR fixture with zero logs (`normalizeBrComposition` the fixture): coverage known per side matches the
  killmail characters (side 0 has 142, side 1 has 49 distinct characters as computed by the coordinator — verify);
  `killmailDamage` of `char:<Zeikku Targaryen's id>` is 54,034 on 15 killmails (look the id up in the names fixture).
- Determinism: the same state analyzed twice is deep-equal; log order does not change the result.
- Performance: 30 logs × 3,000 events (generate them in the test) analyze in under 500 ms.

## Evidence for worker_done
`./check-all.sh` tail; the measured performance; every definition you had to interpret.

Placement: this machine (local), the user named it.
