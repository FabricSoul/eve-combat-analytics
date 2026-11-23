"""Build eve.db and stage its content-addressed gzip and metadata for ETL.

Adapted from pyfa-phone (GPL-3.0-or-later).
"""

import gzip
import hashlib
import json
import shutil
import sqlite3
import subprocess
import sys
import tempfile
from contextlib import closing
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
PYFA = ROOT / "vendor" / "pyfa"
BUILD = ROOT / "build"
DATA = ROOT / "public" / "fit-data"
MAX_BYTES = 25 * 1024 * 1024

# Keep the English EFT item names. eos still maps the other columns.
UNUSED_SUFFIXES = ("_fr", "_ja", "_ko", "_ru", "_zh")
TRANSLATED = {
    "invtypes": ("typeName", "typeDescription"),
    "invgroups": ("name",),
    "invcategories": ("name",),
    "invmarketgroups": ("marketGroupName", "marketGroupDescription"),
    "invmetagroups": ("metaGroupName",),
    "dgmattribs": ("displayName",),
}


# pyfa's root config.py imports wx; stand in for the two names it uses.
BOOTSTRAP = """
import runpy, sys, types
wx = types.ModuleType("wx")
wx.Colour = lambda *a: a
wx.GetTranslation = lambda s: s
sys.modules["wx"] = wx
sys.path.insert(0, ".")
runpy.run_path("db_update.py", run_name="__main__")
"""


def build_db(dest: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="pyfa-etl-") as tmp:
        work = Path(tmp) / "pyfa"
        shutil.copytree(PYFA, work, ignore=shutil.ignore_patterns(".git", "imgs", "eve.db", "__pycache__"))
        subprocess.run([sys.executable, "-c", BOOTSTRAP], cwd=work, check=True)
        shutil.move(work / "eve.db", dest)


def gzip_file(src: Path, dest: Path) -> None:
    with open(src, "rb") as f_in, open(dest, "wb") as raw:
        # mtime=0 and no filename keep the output byte-identical across runs.
        with gzip.GzipFile(filename="", mode="wb", fileobj=raw, compresslevel=9, mtime=0) as f_out:
            shutil.copyfileobj(f_in, f_out, 1 << 20)


def strip_unused_languages(db: Path) -> None:
    conn = sqlite3.connect(db)
    for table, bases in TRANSLATED.items():
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})")}
        sets = [
            f"{base}{suffix} = NULL"
            for base in bases
            for suffix in UNUSED_SUFFIXES
            if f"{base}{suffix}" in cols
        ]
        if sets:
            conn.execute(f"UPDATE {table} SET {', '.join(sets)}")
    conn.commit()
    conn.execute("VACUUM")
    conn.close()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(1 << 20):
            h.update(chunk)
    return h.hexdigest()


def main() -> None:
    BUILD.mkdir(exist_ok=True)
    DATA.mkdir(parents=True, exist_ok=True)
    db = BUILD / "eve.db"
    metadata = BUILD / "game-db.json"
    if not (PYFA / "db_update.py").is_file():
        sys.exit("Initialize the vendor/pyfa submodule before building fit assets")
    revision = subprocess.check_output(
        ["git", "rev-parse", "HEAD"], cwd=PYFA, text=True,
    ).strip()
    builder = sha256(Path(__file__))
    if metadata.is_file() and db.is_file():
        previous = json.loads(metadata.read_text())
        if (previous.get("pyfaRevision") == revision
                and previous.get("builderSha256") == builder
                and (DATA / previous["db"]["file"]).is_file()):
            print(f"Reusing {previous['db']['file']} ({previous['db']['bytes']} bytes)")
            return

    with tempfile.TemporaryDirectory(prefix="fit-db-", dir=BUILD) as tmp:
        stage = Path(tmp)
        staged_db = stage / "eve.db"
        build_db(staged_db)
        strip_unused_languages(staged_db)
        gz = stage / "eve.db.gz"
        gzip_file(staged_db, gz)
        size = gz.stat().st_size
        if size >= MAX_BYTES:
            sys.exit(f"{gz.name} is {size} bytes, over the 25 MiB Cloudflare asset limit")

        digest = sha256(gz)
        asset = f"eve.{digest}.db.gz"
        with closing(sqlite3.connect(staged_db)) as conn:
            client_build = conn.execute(
                "SELECT field_value FROM metadata WHERE field_name='client_build'"
            ).fetchone()[0]
        staged_metadata = stage / "game-db.json"
        staged_metadata.write_text(json.dumps({
            "clientBuild": client_build,
            "pyfaRevision": revision,
            "builderSha256": builder,
            "db": {"file": asset, "bytes": size, "sha256": digest, "encoding": "gzip"},
        }))
        gz.replace(DATA / asset)
        staged_db.replace(db)
        staged_metadata.replace(metadata)
    print(f"{asset}: {size} bytes ({size / 1024 / 1024:.2f} MiB)")


if __name__ == "__main__":
    main()
