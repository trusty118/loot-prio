#!/usr/bin/env python3
"""Build the BiS wording review page from verify/bis-raw.json.

    python3 verify/dump_bis_raw.py      # first, or whenever the guides or the maps change
    python3 verify/review_page.py       # -> verify/review/{index.html, review-data.json}

The page groups every guide row by spec, phase and slot heading, with the author's blurb
above the table - because a rank cell cannot be judged alone. Each row carries the id the
rank map keys on ("Arms/P1/28730"), and the verdict is the one the pipeline actually
reached, since the dump is produced by the same stages that write bis.json.

verify/review/ is gitignored: it is regenerable output, and the template beside it is the
one file that is source. Publish the two files together (index.html fetches
review-data.json by relative path).
"""
import json
import re
import shutil
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent
RAW = HERE / "bis-raw.json"
OUT = HERE / "review"
TEMPLATE = OUT / "template.html"

TIER = {1: "phase", 2: "multiPhase", 3: "expansion"}


def heading(h):
    """"Best in Slot Head Armor for Arms Warrior in TBC Classic Phase 1" -> "Head Armor"."""
    m = re.search(r"Best in Slot (.*?) for ", h)
    return m.group(1) if m else h


def main():
    if not RAW.exists():
        print(f"{RAW.relative_to(ROOT)} is missing - run verify/dump_bis_raw.py first")
        return 1
    raw = json.loads(RAW.read_text(encoding="utf-8"))["rows"]
    loot = {r["id"]: r for r in json.loads((ROOT / "data/loot_data.json").read_text(encoding="utf-8"))}
    rules = json.loads((ROOT / "data/rules.json").read_text(encoding="utf-8"))
    zone_phase = {z: p["id"] for p in rules["phases"] for z in p["zones"]}

    blurbs, bidx, rows = [], {}, []
    for r in raw:
        b = r.get("blurb") or ""
        if b not in bidx:
            bidx[b] = len(blurbs)
            blurbs.append(b)
        rec = loot.get(r["item_id"])
        title = r["item"]
        if r["swapped"] and rec:
            title = f"{title} → {rec['item']}"
        if rec is None:
            o = "noitem"
        elif not (r["kept"] or r["alternate"]):
            o = "dropped"
        elif r["near"]:
            o = "alt"
        else:
            o = TIER[r["tier"]]
            if r["conditional"]:
                o = "cond-" + o
        row = {"s": r["spec"], "p": r["phase"], "n": r["row"], "i": r["item_id"], "t": title,
               "r": r["rank"], "h": heading(r.get("heading") or ""), "b": bidx[b], "o": o,
               "k": 1 if r["kept"] else 0, "w": r.get("why") or ""}
        # Where the item ACTUALLY drops. A later guide re-listing an earlier phase's item is
        # a third of all entries and is not noise - it is the evidence for how long an item
        # lasts - but it is not a row anybody can act on in THIS phase, so it is marked.
        if rec is not None:
            dp = zone_phase.get(rec["zone"])
            if dp and dp != r["phase"]:
                row["d"] = dp
        rows.append(row)

    OUT.mkdir(exist_ok=True)
    (OUT / "review-data.json").write_text(
        json.dumps({"blurbs": blurbs, "rows": rows}, ensure_ascii=False), encoding="utf-8")
    shutil.copyfile(TEMPLATE, OUT / "index.html")
    print(f"{len(rows)} rows, {len(blurbs)} blurbs, "
          f"{sum(1 for r in rows if 'd' in r)} marked as dropping in another phase")
    print(f"Wrote {OUT.relative_to(ROOT)}/index.html and review-data.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
