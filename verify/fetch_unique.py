"""Add a `unique` flag to every record in data/loot_data.json, from Wowhead.

    python verify/fetch_unique.py            # dry run
    python verify/fetch_unique.py --write    # apply

Whether an item is unique decides whether the same spec may appear twice in a
priority: you can only be told to take two of something if you can equip two.

The flag comes from the item tooltip, which carries a literal "<br>Unique" (or
"Unique-Equipped") line. Kept as a script rather than a one-off so it can be
re-run if the item set changes.
"""

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOOT = ROOT / "data" / "loot_data.json"
URL = "https://nether.wowhead.com/tbc/tooltip/item/{}"

# "<br>Unique" or "<br>Unique-Equipped: ...", not the word inside other prose
UNIQUE = re.compile(r"<br\s*/?>\s*Unique(-Equipped)?\b", re.I)


def fetch(item_id):
    req = urllib.request.Request(URL.format(item_id), headers={"User-Agent": "loot-prio/1.0"})
    with urllib.request.urlopen(req, timeout=25) as r:
        return json.load(r)


def main():
    write = "--write" in sys.argv
    loot = json.loads(LOOT.read_text(encoding="utf-8"))

    unique_count, failures, mismatches = 0, [], []

    for i, rec in enumerate(loot, 1):
        try:
            doc = fetch(rec["id"])
        except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as e:
            failures.append(f"{rec['item']} ({rec['id']}): {e}")
            continue

        # the id must actually be the item we think it is
        if doc.get("name") and doc["name"] != rec["item"]:
            mismatches.append(f"id {rec['id']}: we call it {rec['item']!r}, Wowhead says {doc['name']!r}")

        # Only recorded when true: most items aren't unique, and 150-odd
        # "unique": false lines would be noise. Absence means not unique.
        if UNIQUE.search(doc.get("tooltip", "")):
            rec["unique"] = True
            unique_count += 1
        else:
            rec.pop("unique", None)

        if i % 25 == 0:
            print(f"  {i}/{len(loot)}...")
        time.sleep(0.15)   # be polite to their API

    print(f"\n{len(loot)} items | {unique_count} unique | {len(loot) - unique_count} not")

    if mismatches:
        print(f"\nname mismatches ({len(mismatches)}):")
        for m in mismatches:
            print(f"  {m}")

    if failures:
        print(f"\nFAILED to fetch ({len(failures)}) - not written:")
        for f in failures:
            print(f"  {f}")
        return 1

    if not write:
        print("\nDry run. Re-run with --write to apply.")
        return 0

    LOOT.write_text(json.dumps(loot, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {LOOT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
