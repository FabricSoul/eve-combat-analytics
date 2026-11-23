"""Export EFT rack and display names from the pinned pyfa eve.db.

Usage: python3 src/app/battle/person/export-fit-items.py build/eve.db
The existing killmail-types catalog covers English EFT names.
"""
import json
import sqlite3
import sys
from pathlib import Path

source = Path(sys.argv[1]).resolve()
with sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True) as db:
    slots = dict(db.execute("""
        SELECT typeID, MIN(effectID)
        FROM dgmtypeeffects
        WHERE effectID IN (11, 12, 13, 2663, 3772, 6306)
        GROUP BY typeID
        ORDER BY typeID
    """))
    localized = dict(db.execute("""
        SELECT t.typeID, t.typeName_zh FROM invtypes t JOIN invgroups g USING(groupID)
        WHERE g.categoryID IN (7, 8, 18, 22, 23, 32, 65, 66, 87)
          AND t.typeName_zh != '' AND t.published = 1
        ORDER BY t.typeID
    """))
    Path(__file__).with_name("fit-items.json").write_text(
        json.dumps({"slots": slots, "localized": localized}, ensure_ascii=False, separators=(",", ":")) + "\n",
        encoding="utf-8",
    )
