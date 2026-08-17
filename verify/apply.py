"""Apply verified boss attributions from boss-attribution.csv back into loot_data.json.

Usage:
    python verify/apply.py            # dry run: report what would change
    python verify/apply.py --write    # actually update data/loot_data.json
"""

import csv
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data" / "loot_data.json"
CSV_PATH = ROOT / "verify" / "boss-attribution.csv"

VALID_BOSSES = {
    "High Warlord Naj'entus",
    "Supremus",
    "Shade of Akama",
    "Teron Gorefiend",
    "Gurtogg Bloodboil",
    "Reliquary of Souls",
    "Mother Shahraz",
    "Illidari Council",
    "Illidan Stormrage",
    "Trash",
}


def truthy(value):
    return value.strip().lower() in {"y", "yes", "true", "1", "x", "ok"}


def main():
    write = "--write" in sys.argv

    records = json.loads(DATA.read_text(encoding="utf-8"))
    by_id = {}
    for rec in records:
        by_id.setdefault(rec["id"], []).append(rec)

    with CSV_PATH.open(encoding="utf-8-sig", newline="") as fh:
        rows = list(csv.DictReader(fh))

    changed, confirmed, skipped, problems = [], [], 0, []

    for row in rows:
        item_id = int(row["id"])
        targets = by_id.get(item_id)

        if not targets:
            problems.append(f"id {item_id} ({row['item']}) is not in loot_data.json")
            continue
        if len(targets) > 1:
            problems.append(f"id {item_id} ({row['item']}) matches {len(targets)} records")
            continue

        rec = targets[0]

        if not truthy(row.get("ok", "")):
            skipped += 1
            continue

        new_boss = row["correct_boss"].strip()

        if new_boss.upper() == "REMOVE":
            problems.append(f"{rec['item']} marked REMOVE - handle this one manually")
            continue
        if new_boss not in VALID_BOSSES:
            problems.append(f"{rec['item']}: '{new_boss}' is not a known Black Temple boss")
            continue

        if new_boss != rec["boss"]:
            changed.append((rec["item"], rec["boss"], new_boss))
            rec["boss"] = new_boss
        else:
            confirmed.append(rec["item"])

        rec.pop("verifyBoss", None)

    print(f"corrected:      {len(changed)}")
    for item, old, new in changed:
        print(f"  {item}: {old} -> {new}")
    print(f"confirmed:      {len(confirmed)}")
    print(f"not yet checked: {skipped}")

    if problems:
        print(f"\nproblems ({len(problems)}):")
        for p in problems:
            print(f"  {p}")

    still_flagged = sum(1 for r in records if r.get("verifyBoss"))
    print(f"\nstill flagged after this pass: {still_flagged}")

    if not write:
        print("\nDry run. Re-run with --write to apply.")
        return 1 if problems else 0

    # indent=1 matches the existing file, so diffs show only the changed lines
    DATA.write_text(
        json.dumps(records, indent=1, ensure_ascii=False), encoding="utf-8"
    )
    print(f"\nWrote {DATA.relative_to(ROOT)}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
