"""Regroup data/loot_data.json by zone, then by kill order within a zone.

    python verify/regroup.py

fetch_items.py appends whichever zones it built, so a freshly imported phase lands at
the end of the file whatever its place in the expansion. Display order comes from
ZONE_ORDER and never depends on this - what depends on it is being able to hand-edit
the file, which CLAUDE.md section 2 promises: a boss's items sit together, in the order
you kill them.

Both orders are read out of app.js rather than restated here, so there is no second
list to drift from the one the site actually uses.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOOT = ROOT / "data" / "loot_data.json"


def main():
    app = (ROOT / "app.js").read_text(encoding="utf-8")

    phases = re.search(r"var PHASES = \[(.*?)\n  \];", app, re.S).group(1)
    zone_order = re.findall(r'"([^"]+)"', re.sub(r'(id|label):\s*"[^"]*"', "", phases))

    boss_block = re.search(r"var BOSS_ORDER = \{(.*?)\n  \};", app, re.S).group(1)
    boss_order = {z: re.findall(r'"([^"]+)"', body)
                  for z, body in re.findall(r'"([^"]+)":\s*\[(.*?)\]', boss_block, re.S)}

    loot = json.loads(LOOT.read_text(encoding="utf-8"))

    unknown = sorted({r["zone"] for r in loot} - set(zone_order))
    if unknown:
        print(f"zones app.js does not list, sorted to the end: {unknown}")

    def key(rec):
        z = zone_order.index(rec["zone"]) if rec["zone"] in zone_order else len(zone_order)
        bosses = boss_order.get(rec["zone"], [])
        b = bosses.index(rec["boss"]) if rec["boss"] in bosses else len(bosses)
        return (z, b)

    before = [(r["zone"], r["boss"]) for r in loot]
    loot.sort(key=key)              # stable, so item order within a boss is untouched
    if [(r["zone"], r["boss"]) for r in loot] == before:
        print("already grouped")
        return 0

    LOOT.write_text(json.dumps(loot, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    seen = []
    for r in loot:
        if not seen or seen[-1] != r["zone"]:
            seen.append(r["zone"])
    print("regrouped: " + " -> ".join(seen))
    return 0


if __name__ == "__main__":
    sys.exit(main())
