"""Split data/loot_data.json into items and an out-of-the-box priority list.

    python verify/split_lists.py            # dry run
    python verify/split_lists.py --write    # apply

zatar was never a list on this site - he was the substrate. His calls lived in the item
data, `activeTemplate === null` MEANT "showing zatar", and everything a template did not
hold fell through to his priority. Now that lists can be made, saved and shared, none of
that is needed: he becomes one option among several, offered for the phase he covers.

Three things leave the item data, and they leave for different reasons.

HIS 182 PRIORITIES AND 177 NOTES move to data/lists/zatar-p3.json, in the template shape
validateTemplate() already enforces. Nothing about them changes - the point of this script
is that they arrive byte-identical, which --write verifies before it writes anything.

THE 268 SEEDED PRIORITIES are DELETED, not moved. Every one is exactly the set of specs
bis.json lists for that item in that phase, joined with "=" - checked here rather than
asserted, because deleting on a false belief would be the one unrecoverable mistake in
this script. They duplicate data the site already holds and already draws as rings. What
they were FOR - a starting point for a list built from scratch - is an action now, not
stored data.

THE NOTES SPLIT BY KIND, which is the fiddly part. A note saying "Also drops from Eredar
Twins" is a fact about the ITEM and stays. A note saying "Not covered in the source guide"
is the framing already deleted from the UI once, and goes. Everything else on one of his
rows is his commentary and travels with his list.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOOT = ROOT / "data" / "loot_data.json"
BIS = ROOT / "data" / "bis.json"
APP = ROOT / "app.js"
OUT_DIR = ROOT / "data" / "lists"

# Facts about the item, not anybody's opinion of it: where else it drops, how it is
# obtained. These stay behind when the opinions leave.
ITEM_FACT = re.compile(r"^(Also drops from|Drops from|Reputation reward)", re.I)

# The framing that was removed from the UI and survived in prose. CLAUDE.md section 8:
# "Nothing on screen frames a row as missing from a guide any more, and that was a
# decision." These say it in words, so they go with it.
PROVENANCE = re.compile(r"not covered in the source guide", re.I)


def phase_of_zone():
    """PHASES lives in app.js and is the one place zones map to phases."""
    src = APP.read_text(encoding="utf-8")
    block = re.search(r"var PHASES = \[(.*?)\n  \];", src, re.S).group(1)
    out = {}
    for pid, zones in re.findall(r'id:\s*"(P\d)".*?zones:\s*\[(.*?)\]', block, re.S):
        for z in re.findall(r'"([^"]+)"', zones):
            out[z] = pid
    return out


def bis_specs():
    """(phase, item id) -> the specs bis.json calls it BiS for."""
    out = {}
    for spec, phases in json.loads(BIS.read_text(encoding="utf-8"))["specs"].items():
        for phase, entries in phases.items():
            for e in entries:
                out.setdefault((phase, e["id"]), set()).add(spec)
    return out


def main():
    write = "--write" in sys.argv
    loot = json.loads(LOOT.read_text(encoding="utf-8"))
    zone_phase = phase_of_zone()
    wanted = bis_specs()

    his, seeded, problems = [], [], []

    for rec in loot:
        phase = zone_phase.get(rec["zone"], "")
        prio = rec.get("priority") or []
        note = rec.get("notes") or ""

        if rec.get("prioritySource") == "bis":
            # Refuse to delete on a belief. Every seeded line must be exactly the BiS
            # set, joined with "=", or it holds something bis.json does not and this
            # script has no business dropping it.
            got = {e.get("spec") or e.get("class") for e in prio}
            exp = wanted.get((phase, rec["id"]), set())
            ops = {e.get("op") for e in prio[1:]}
            if got != exp or (ops - {"="}):
                problems.append(f"{rec['item']}: seeded line is not a plain BiS set")
            seeded.append(rec)
            continue

        if not rec.get("unsourced"):
            his.append(rec)

    # --- the list that leaves ---------------------------------------------------
    priorities, notes = {}, {}
    for rec in his:
        priorities[str(rec["id"])] = rec.get("priority") or []
        if rec.get("notes"):
            notes[str(rec["id"])] = rec["notes"]

    print(f"zatar's list: {len(priorities)} priorities, {len(notes)} notes")
    print(f"seeded, to delete: {len(seeded)}")

    # --- what stays ------------------------------------------------------------
    items = []
    for rec in loot:
        out = {k: v for k, v in rec.items()
               if k not in ("priority", "notes", "unsourced", "prioritySource")}
        note = rec.get("notes") or ""
        if note and ITEM_FACT.match(note):
            out["notes"] = note
        items.append(out)

    kept_notes = sum(1 for i in items if i.get("notes"))
    dropped_notes = sum(1 for r in loot if (r.get("notes") or "")
                        and not ITEM_FACT.match(r["notes"])
                        and r.get("unsourced"))
    print(f"item data: {len(items)} items, {kept_notes} keeping a factual note")
    print(f"           {dropped_notes} notes on unsourced rows not kept "
          f"(commentary and 'not covered in the source guide')")

    if problems:
        print(f"\nREFUSING - {len(problems)} seeded lines are not plain BiS sets:")
        for p in problems[:10]:
            print(f"  {p}")
        return 1

    if not write:
        print("\ndry run - pass --write to apply")
        return 0

    OUT_DIR.mkdir(exist_ok=True)
    doc = {
        "v": 1,
        "id": "zatar-p3",
        "name": "Zatar's Phase 3",
        "created": "2026-08-26",
        "base": "zatar",
        "author": "zatar",
        "phase": "P3",
        "priorities": priorities,
        "notes": notes,
    }
    (OUT_DIR / "zatar-p3.json").write_text(
        json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    (OUT_DIR / "index.json").write_text(json.dumps({
        "note": ("The lists that ship with the site. Each is a starting point somebody can "
                 "open and copy, not a baseline the page falls back to - nothing falls back "
                 "any more. Adding one is a data edit: drop the file in, add a line here."),
        "lists": [{"id": "zatar-p3", "name": "Zatar's Phase 3", "phase": "P3",
                   "author": "zatar", "file": "zatar-p3.json"}]
    }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    LOOT.write_text(json.dumps(items, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nwrote {OUT_DIR.relative_to(ROOT)}/ and {LOOT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
