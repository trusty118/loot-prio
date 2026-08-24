"""Give the Zul'Aman and Sunwell rows a starting priority, from their BiS lists.

    python verify/seed_priority.py            # dry run
    python verify/seed_priority.py --write    # apply

zatar's videos covered Black Temple and Mount Hyjal. Those two raids are the whole of
his guide, and every Zul'Aman and Sunwell row therefore has an empty priority - which
also means no spec icons, which means the BiS rings have nothing to hang off and 779
correct entries render nothing at all.

So those rows are seeded from BiS: every spec that calls the item best-in-slot, joined
with "=" because nothing here ranks them. It is a starting point to be refined by hand,
not an answer.

WHAT THIS MUST NOT DO is let a generated ordering read as one of his calls. That is what
CLAUDE.md section 8 is about, and why check_priority.py makes `unsourced` plus a priority
an error. The rows keep `unsourced: true`, because it stays true - the guide never covered
them - and gain `prioritySource: "bis"`, which is the only thing that makes the pairing
legal. A row with a priority and no marker is still an error, exactly as before.

Black Temple, Mount Hyjal and the crafted rows are NEVER touched: they carry his calls.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOOT = ROOT / "data" / "loot_data.json"
BIS = ROOT / "data" / "bis.json"
SPECS = ROOT / "data" / "specs.json"

# which phase's BiS list speaks for a zone
ZONE_PHASE = {
    "Karazhan": "P1", "Gruul's Lair": "P1", "Magtheridon's Lair": "P1",
    "Serpentshrine Cavern": "P2", "Tempest Keep": "P2", "Crafted (Nether Vortex)": "P2",
    "Black Temple": "P3", "Mount Hyjal": "P3", "Crafted (Heart of Darkness)": "P3",
    "Zul'Aman": "P4",
    "Sunwell Plateau": "P5", "Crafted (Sunmote)": "P5",
}


def main():
    write = "--write" in sys.argv
    loot = json.loads(LOOT.read_text(encoding="utf-8"))
    bis = json.loads(BIS.read_text(encoding="utf-8"))["specs"]
    order = list(json.loads(SPECS.read_text(encoding="utf-8"))["specs"])

    # item id -> specs calling it BiS in the phase its own zone belongs to
    wanted = {}
    for spec, phases in bis.items():
        for phase, entries in phases.items():
            for entry in entries:
                wanted.setdefault((phase, entry["id"]), set()).add(spec)

    seeded = skipped = already = 0
    for rec in loot:
        # his raids are his. Nothing here goes near them.
        if not rec.get("unsourced"):
            continue
        if rec.get("priority"):
            already += 1
            continue
        specs = wanted.get((ZONE_PHASE.get(rec["zone"], ""), rec["id"]))
        if not specs:
            skipped += 1
            continue
        # registry order, so the same input always writes the same file
        picked = [s for s in order if s in specs]
        rec["priority"] = [
            {"spec": s} if i == 0 else {"spec": s, "op": "="}
            for i, s in enumerate(picked)
        ]
        rec["prioritySource"] = "bis"
        seeded += 1

    print(f"{seeded} rows seeded from BiS, {skipped} left empty (BiS for nobody we list), "
          f"{already} already had a priority")

    if not write:
        print("\ndry run - pass --write to apply")
        return 0

    LOOT.write_text(json.dumps(loot, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nwrote {LOOT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
