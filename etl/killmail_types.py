"""Export English EFT names and charge classification from the pinned pyfa eve.db.

Usage: python3 etl/killmail_types.py build/eve.db src/core/data/killmail-types.json
Source: CCP static game data packaged by pyfa (GPL-3.0-or-later).
"""
import json
import sqlite3
import sys
from contextlib import closing
from pathlib import Path


def export(db: Path, out: Path) -> None:
    with closing(sqlite3.connect(db)) as conn:
        rows = conn.execute("""
            SELECT t.typeID, t.typeName, g.categoryID
            FROM invtypes t JOIN invgroups g USING (groupID)
            WHERE g.categoryID IN (6, 7, 8, 18, 22, 23, 32, 65, 66, 87)
              AND t.typeName != ''
            ORDER BY t.typeID
        """)
        items, charges = {}, {}
        for type_id, name, category in rows:
            (charges if category == 8 else items)[type_id] = name

        # A killmail gives only the resulting generic abyssal type. Pick the
        # matching Tech II item if eligible, then Tech I, then the oldest
        # published eligible base item by type ID.
        bases = conn.execute("""
            SELECT DISTINCT m.resultingTypeID, result.typeName, base.typeID, base.typeName
            FROM mutaplasmids m
            JOIN mutaplasmidItems mi USING (typeID)
            JOIN invtypes result ON result.typeID = m.resultingTypeID
            JOIN invtypes base ON base.typeID = mi.applicableTypeID
            WHERE base.published = 1
            ORDER BY base.typeID
        """)
        replacements = {}
        for result_id, result_name, base_id, base_name in bases:
            if result_id not in items or base_id not in items:
                continue
            family = result_name.removeprefix("Abyssal ")
            rank = (base_name != f"{family} II", base_name != f"{family} I", base_id)
            if result_id not in replacements or rank < replacements[result_id][0]:
                replacements[result_id] = (rank, base_name)
        for type_id, (_, base_name) in replacements.items():
            items[type_id] = base_name

    out.write_text(
        json.dumps({"items": items, "charges": charges}, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    export(*map(Path, sys.argv[1:]))
