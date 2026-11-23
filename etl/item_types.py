"""Export weapon, module, charge, drone and fighter type names (en + zh) from pyfa's eve.db.

Usage: python3 etl/item_types.py <path/to/eve.db> src/core/data/item-types.json
Categories: 7 modules, 8 charges, 18 drones, 87 fighters, 22 deployables, 66 structure modules, 23 starbase, 32 subsystems.
Source data: CCP's static data as packaged by pyfa (GPLv3); EVE names are CCP's property.
"""
from collections import defaultdict
import json
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
db = sys.argv[1] if len(sys.argv) > 1 else str(ROOT / "build" / "eve.db")
out = sys.argv[2] if len(sys.argv) > 2 else str(ROOT / "src" / "core" / "data" / "item-types.json")

# Small verified alias table: normalized name -> pinned type ID.
# Ambiguous names (mapping to multiple type IDs after normalization) are dropped from export
# unless explicitly pinned here to a verified canonical type ID.
PINNED_ALIASES: dict[str, int] = {
    # e.g., if a duplicate name should resolve to a specific type ID, pin it here.
    # Unpinned ambiguous names (such as '莱塞勒氏改良型爆炸装甲增强器') are dropped.
}


def normalize(s: str) -> str:
    if not s:
        return ""
    s = s.strip()
    while s.endswith("*"):
        s = s[:-1].strip()
    return (
        s.lower()
        .replace("’", "'")
        .replace("‘", "'")
        .replace("“", '"')
        .replace("”", '"')
    )


c = sqlite3.connect(db)
rows = c.execute(
    """select t.typeID, t.typeName, t.typeName_zh
       from invtypes t join invgroups g on g.groupID = t.groupID
       where g.categoryID in (7, 8, 18, 87, 22, 66, 23, 32)
         and (t.published = 1 or g.categoryID in (7, 8, 18, 87))
       order by t.typeID"""
).fetchall()

# 1. Detect all names (en and zh, after normalization) that map to more than one type ID
name_to_ids: dict[str, set[int]] = defaultdict(set)
for type_id, en, zh in rows:
    if en:
        name_to_ids[normalize(en)].add(type_id)
    if zh:
        name_to_ids[normalize(zh)].add(type_id)

ambiguous_names = {
    norm: ids
    for norm, ids in name_to_ids.items()
    if len(ids) > 1 and norm not in PINNED_ALIASES
}

print(f"Ambiguous names found at export: {len(ambiguous_names)}")
for norm, ids in sorted(ambiguous_names.items()):
    print(f"  {norm!r} -> type IDs {sorted(ids)} (dropped)")

# 2. Build types array, dropping any ambiguous names unless pinned
types = []
for type_id, en, zh in rows:
    if not en:
        continue

    norm_en = normalize(en)
    if norm_en in ambiguous_names:
        en_val = None
    elif norm_en in PINNED_ALIASES:
        en_val = en if PINNED_ALIASES[norm_en] == type_id else None
    else:
        en_val = en

    if zh:
        norm_zh = normalize(zh)
        if norm_zh in ambiguous_names:
            zh_val = None
        elif norm_zh in PINNED_ALIASES:
            zh_val = zh if PINNED_ALIASES[norm_zh] == type_id else None
        else:
            zh_val = zh
    else:
        zh_val = None

    if en_val or zh_val:
        types.append([type_id, en_val or en, zh_val])

with open(out, "w", encoding="utf-8") as f:
    json.dump(types, f, ensure_ascii=False, separators=(",", ":"))

print(f"Exported {len(types)} item types to {out}")
