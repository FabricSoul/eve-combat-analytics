"""Export localized weapon classes from the pinned pyfa database and item catalog.

Run from the repository root: python3 src/app/battle/hits/export-weapon-classes.py build/eve.db
Export only labels of known weapons so the aggregation does not load the entire item catalog.
"""
import json
import sqlite3
import sys
from pathlib import Path

catalog = json.loads(Path("src/core/data/item-types.json").read_text())
classes = {}
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
        if category in (18, 87):
            classes[ident] = "drone"
        elif turret or (category == 8 and any(name in group for name in turret_ammo)):
            classes[ident] = "turret"
        elif launcher or (category == 8 and any(name in group for name in ("missile", "rocket", "torpedo"))):
            classes[ident] = "missile"

# Mirror item-types normalization. Omit a label if any catalog item gives it a
# conflicting class, including unclassified items that use the same label.
labels = {}
for ident, english, chinese in catalog:
    kind = classes.get(ident)
    for name in (english, chinese):
        if name:
            key = name.strip().rstrip("*").strip().lower().translate(str.maketrans("‘’“”", "''\"\""))
            labels.setdefault(key, set()).add(kind)
result = {
    kind: sorted(name for name, candidates in labels.items() if candidates == {kind})
    for kind in ("turret", "missile", "drone")
}
Path(__file__).with_name("weapon-classes.json").write_text(
    json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
)
