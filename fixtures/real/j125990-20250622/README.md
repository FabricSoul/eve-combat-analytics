# Real fight fixture: J125990, 2025-06-22 15:38–16:42 UTC

17 real Gamelogs (10 Simplified Chinese clients, 7 English) from one wormhole fight, shared by the project owner with
permission to publish them as test data. `logs/*.txt.gz` are the files exactly as the game wrote them (gzip -9 -n).

- `killmail-128067587.json` — public CCP ESI response for Blanchard2213’s Leshak, fetched on 2026-11-23 from
  `https://esi.evetech.net/latest/killmails/128067587/42b867dc1f91c954e728f170ca9f2e5d40a2d6eb/`.
- `related.json` — br.evetools.org `newapi/br/related/31002058/202506221600` (52 killmails).
- `esi.json` — public ESI lookups made on 2026-11-22: names for every id, the counterparty name index, and each
  uploader's character id and side. Sides are inferred from the uploaders' alliances (this fight has no BR teams).

Tests read these offline; nothing here requires network access.
- `br-6b03a9aff85099ccb2b7e763.composition.json` — the real BR the owner generated for this fight
  (br.evetools.org/br/6b03a9aff85099ccb2b7e763). Its teams put Lucinda HIly's alliance on the wrong side; her log
  shows otherwise. `realBattleStateWithBr()` loads it.
