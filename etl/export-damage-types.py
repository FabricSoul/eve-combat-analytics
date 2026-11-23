"""Export single-type damage sources from the pinned pyfa eve.db.

Usage: python3 etl/export-damage-types.py build/eve.db
Mixed damage is deliberately omitted: combat logs report only total applied HP.
"""
import json
import sqlite3
import sys
from pathlib import Path

source = Path(sys.argv[1]).resolve()
with sqlite3.connect(f"{source.as_uri()}?mode=ro", uri=True) as db:
    types = db.execute("""
        SELECT t.typeName, t.typeName_zh, MIN(a.attributeID)
        FROM invtypes t JOIN invgroups g USING (groupID)
        JOIN dgmtypeattribs a USING (typeID)
        WHERE (g.categoryID IN (8, 18) OR t.groupID = 72)
          AND a.attributeID IN (114, 116, 117, 118) AND a.value > 0
        GROUP BY t.typeID
        HAVING COUNT(*) = 1
        ORDER BY t.typeID
    """)
    kinds = {114: "em", 116: "explosive", 117: "kinetic", 118: "thermal"}
    result = {
        name: kinds[kind]
        for english, chinese, kind in types
        for name in (english, chinese)
        if name
    }
    (Path(__file__).resolve().parents[1] / "src/app/battle/compare/damage-types.json").write_text(
        json.dumps(result, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
        encoding="utf-8",
    )
