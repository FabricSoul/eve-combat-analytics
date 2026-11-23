"""Export ship-like type names (en + zh) from pyfa's eve.db for the Gamelog counterparty splitter.

Usage: python3 etl/ship_types.py <path/to/eve.db> src/core/data/ship-types.json
Categories: 6 ships, 18 drones, 87 fighters, 65 structures, 22 deployables, 23 starbase. Published types only.
Source data: CCP's static data as packaged by pyfa (GPLv3); EVE names are CCP's property.
"""
import json, sqlite3, sys

db, out = sys.argv[1], sys.argv[2]
c = sqlite3.connect(db)
rows = c.execute(
    """select t.typeID, t.typeName, t.typeName_zh, g.categoryID, g.name
       from invtypes t join invgroups g on g.groupID = t.groupID
       where g.categoryID in (6, 18, 87, 65, 22, 23) and t.published = 1
       order by t.typeID"""
).fetchall()
types = [
    {"id": i, "en": en, "zh": zh or None, "category": cat, "group": grp}
    for i, en, zh, cat, grp in rows
    if en
]
with open(out, "w", encoding="utf-8") as f:
    json.dump(types, f, ensure_ascii=False, separators=(",", ":"))
print(len(types), "types")
