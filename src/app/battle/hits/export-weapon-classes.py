"""Export localized weapon classes from the item catalog and pinned pyfa metadata.

Run from the repository root: python3 src/app/battle/hits/export-weapon-classes.py build/eve.db
Export only labels of known weapons so the aggregation does not load the entire item catalog.
"""
import json
import sqlite3
import sys
from pathlib import Path

catalog = json.loads(Path("src/core/data/item-types.json").read_text())
groups = json.loads(Path("src/core/data/item-types-groups.json").read_text())
turret_ammo = ("projectile ammo", "hybrid charge", "frequency crystal", "exotic plasma", "condensate")
with sqlite3.connect(f"{Path(sys.argv[1]).resolve().as_uri()}?mode=ro", uri=True) as db:
    group_names = dict(db.execute("select groupID, lower(name) from invgroups"))
    effects_by_group = {}
    for group, effect in db.execute("""
        select distinct t.groupID, e.effectID
        from invtypes t join dgmtypeeffects e using (typeID)
        where e.effectID in (40,42)
    """):
        effects_by_group.setdefault(group, set()).add(effect)

classes = {}
for group, category, ids in groups:
    name = group_names.get(group, "")
    effects = effects_by_group.get(group, set())
    if category in (18, 87):
        kind = "drone"
    elif group == 72:
        kind = "smartbomb"
    elif group in (4807, 4808):
        kind = "breacher"
    elif 42 in effects or (category == 8 and any(label in name for label in turret_ammo)):
        kind = "turret"
    elif 40 in effects or (category == 8 and any(label in name for label in ("missile", "rocket", "torpedo"))):
        kind = "missile"
    else:
        continue
    classes.update(dict.fromkeys(ids, kind))

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
    for kind in ("turret", "missile", "drone", "smartbomb", "breacher")
}
Path(__file__).with_name("weapon-classes.json").write_text(
    json.dumps(result, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8"
)
