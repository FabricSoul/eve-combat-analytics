# T1 — Gamelog parser (`parseGamelog`)

{{COMMON}}

## Goal
Implement `parseGamelog: ParseGamelog` from `src/core/contract.ts` in `src/core/log/parse.ts`: turn the text of one
EVE Online Gamelog file (English or Simplified Chinese client) into a `ParsedLog`. This is the foundation every
analysis sits on, so correctness and honest reporting of what is not understood matter more than coverage claims.

## You may edit
`src/core/log/**` (any files you need, e.g. `parse.ts`, `counterparty.ts`, `lang-en.ts`, `lang-zh.ts`, tests),
`fixtures/logs/**` (new fixtures). Nothing else.

## Format knowledge (verify, don't trust blindly)
- Header (lines may have leading spaces, file may use CRLF and may start with a BOM):
  ```
  ------------------------------------------------------------
    Gamelog
    Listener: Apollo Lange
    Session Started: 2026.11.07 13:28:14
  ------------------------------------------------------------
  ```
  The Chinese client writes `游戏记录` / `收听者:` / `会话开始:` (or similar — check sources). No header → throw
  `GamelogFormatError('no_header' | 'no_listener' | 'no_session_start')`.
- Entries: `[ YYYY.MM.DD HH:MM:SS ] (channel) message`. Times are UTC — parse them by hand into epoch ms
  (`Date.UTC`), never with `new Date(string)`. An entry may continue on following physical lines that do not start
  with `[` — join them; `line` is the first physical line, 1-based.
- Only `(combat)` entries become events. Raw combat messages are wrapped in client markup:
  `<color=0xff00ffff><b>366</b> <color=0x77ffffff><font size=10>to</font> <b><color=0xffffffff>Name[TICK](Hurricane)</b><font size=10><color=0x77ffffff> - Heavy Assault Missile - Hits`.
  Strip tags (`<...>`, also HTML-escaped `&lt;...&gt;`), decode `&nbsp;`/`&amp;`/`&gt;`/`&lt;`, collapse spaces.
- Counterparty rendering depends on the listener's overview ship-label settings: `Name[CORP](Ship)`,
  `Name [CORP] [ALLY] (Ship)`, `Ship [Name]`, `[CORP] Name`, NPC names with no brackets, custom ship names in italics
  `<i>…</i>`, structures. `Counterparty.raw` always keeps the stripped text; split name / tickers / ship only when
  unambiguous, else leave those fields null. Corp tickers are ≤5 chars, alliance tickers ≤5.
- English combat forms to cover at least (both directions where they exist):
  damage `N to|from X - Weapon - Quality`, damage without weapon (`N from X - Hits`), damage without quality
  (missiles, drones, smartbombs), structure damage with `(N deflected)`, misses (`Your group of W misses X completely - W`,
  `Your W misses X completely - W`, `X misses you completely`, `X misses you completely - W`), remote armor / shield /
  hull repair `N remote armor repaired to|by X - Module`, `remote shield boosted`, `remote hull repaired`, remote
  capacitor `N remote capacitor transmitted to|by X - Module`, neut `N GJ energy neutralized X - Module` (in and out
  wordings differ — find both), nos `±N GJ energy drained to|from X - Module`, warp `Warp scramble|disruption attempt
  from X to you!` / `from you to X`, and the ewar notices that appear as (combat) if you find evidence for them (jam,
  damp, web, painter, tracking/guidance disruption). Hit qualities: Wrecks, Smashes, Penetrates, Hits, Glances Off,
  Grazes.
- Chinese forms: the previous version of this repo parsed zh logs; its regexes are a starting point:
  `git show 6eb3f3e:src/lib/server/util/dataParser.ts` (e.g. `来自|对`, `远程装甲维修量|远程护盾回充增量`, `至|由`,
  `完全没有打中`, `试图跃迁扰频|扰断`, `GJ能量中和`, `GJ被从|吸取到`, qualities 轻轻擦过/擦过/命中/穿透/强力一击/致命一击).
  Note that old code had a bug: the zh warp regex captures in a different group order than the en one.
- Language detection: header words first, then message vocabulary.
- Anything in a `(combat)` entry you cannot parse goes to `unparsed` with its line and stripped text — never dropped
  silently, never guessed.

## Sources to learn the formats from (format knowledge only, no code copying)
- Real PvE logs (not redistributable — tests may read them only if present, and must `skip` otherwise):
  `/Users/fabric/orca/workspaces/eve-combat-analytics/revive/fixtures/local/session-20261107-from-1942.txt`
  (3,075 combat lines), `session-full-combat.txt`, `curated-lines.txt`.
- github.com/HenriFrancais/evebattlehistory `app/logs/parse.py` (a PvP-aware parser; read its regexes and comments for
  the format variants), github.com/Peppe/EveDpsOverlay `docs/spec/**` and `src/EveDps.Core/LogParser.cs`, EVE
  University wiki pages on combat logs. Use `gh api` to read files.

## Fixtures you write
`fixtures/logs/en-pvp-sample.txt` and `fixtures/logs/zh-pvp-sample.txt`: hand-written logs that exercise every form
above in the real markup style, each starting with a comment block (lines before the header are allowed — make the
parser skip leading junk) that says it is synthetic and lists the source of each line form. Character names in them
are made up.

## Failing tests to write first (`src/core/log/parse.test.ts` and friends)
- Header: listener, sessionStart epoch ms, CRLF + BOM handled; each GamelogFormatError code.
- Every form above in en and zh → the exact event (kind, dir, amount, weapon/module, quality, repairType, ewar,
  counterparty split), including multi-line entries and the `line` number.
- Counterparty splitting for each overview format listed; ambiguous ones keep only `raw`.
- Unknown combat text lands in `unparsed`; non-combat channels produce nothing.
- Events sorted by t then line.
- If the local PvE sample exists: parse it, assert `unparsed.length === 0` (or list and justify the remainder in your
  report) and assert totals you computed independently (e.g. with grep/awk) for damage in/out and misses.
- Performance: a 50,000-line synthetic log parses in under 1 s in vitest.

## Evidence for worker_done
`./check-all.sh` tail; per-form test list; the PvE sample's event counts by kind and its unparsed count; the list of
format variants you found but could not cover.
