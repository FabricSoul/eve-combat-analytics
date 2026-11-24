"""Export known weapon class IDs from the pinned pyfa database.

Run from the repository root: python3 src/app/battle/hits/export-weapon-classes.py build/eve.db
The existing item-types catalog supplies localized names and IDs.
"""
import json
import sqlite3
import sys
from pathlib import Path

ids = {row[0] for row in json.loads(Path("src/core/data/item-types.json").read_text())}
result = {kind: [] for kind in ("turret", "missile", "drone")}
turret_ammo = ("projectile ammo", "hybrid charge", "frequency crystal", "exotic plasma", "condensate")
with sqlite3.connect(f"{Path(sys.argv[1]).resolve().as_uri()}?mode=ro", uri=True) as db:
    rows = db.execute("""
        select t.typeID, g.categoryID, lower(g.name),
               max(case when e.effectID = 42 then 1 else 0 end),
               max(case when e.effectID = 40 then 1 else 0 end)
        from invtypes t join invgroups g using (groupID)
        left join dgmtypeeffects e on e.typeID = t.typeID and e.effectID in (40,42)
        group by t.typeID order by t.typeID
    """)
    for ident, category, group, turret, launcher in rows:
        if ident not in ids:
            continue
        if category in (18, 87):
            result["drone"].append(ident)
        elif turret or (category == 8 and any(name in group for name in turret_ammo)):
            result["turret"].append(ident)
        elif launcher or (category == 8 and any(name in group for name in ("missile", "rocket", "torpedo"))):
            result["missile"].append(ident)
Path(__file__).with_name("weapon-classes.json").write_text(
    json.dumps(result, separators=(",", ":")) + "\n", encoding="utf-8"
)
