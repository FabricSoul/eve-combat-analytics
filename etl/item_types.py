"""Export weapon, module, charge, drone and fighter type names (en + zh) from pyfa's eve.db.

Usage: python3 etl/item_types.py <path/to/eve.db> src/core/data/item-types.json
Categories: 7 modules, 8 charges, 18 drones, 87 fighters, 22 deployables, 66 structure modules, 23 starbase, 32 subsystems.
Source data: CCP's static data as packaged by pyfa (GPLv3); EVE names are CCP's property.
"""
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
db = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "build" / "eve.db")
out = sys.argv[2] if len(sys.argv) > 2 else str(ROOT / "src" / "core" / "data" / "item-types.json")

c = sqlite3.connect(db)
rows = c.execute(
    """select t.typeID, t.typeName, t.typeName_zh
       from invtypes t join invgroups g on g.groupID = t.groupID
       where g.categoryID in (7, 8, 18, 87, 22, 66, 23, 32)
         and (t.published = 1 or g.categoryID in (7, 8, 18, 87))
       order by t.typeID"""
).fetchall()

types = [
    [type_id, en, zh or None]
    for type_id, en, zh in rows
    if en
]

with open(out, "w", encoding="utf-8") as f:
    json.dump(types, f, ensure_ascii=False, separators=(",", ":"))

print(f"Exported {len(types)} item types to {out}")
