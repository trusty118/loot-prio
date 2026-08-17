"""Validate data/bis.json against the loot table and the spec table in app.js.

Usage:
    python verify/check_bis.py

Exits non-zero on errors. Orphans are warnings, not errors: an item can legitimately
be BiS for a spec the priority line never names - it just means no ring is drawn on
that row, because there is no icon for that spec to ring.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOOT = ROOT / "data" / "loot_data.json"
BIS = ROOT / "data" / "bis.json"
APP = ROOT / "app.js"

VALID_TIERS = {"phase", "multiPhase", "expansion"}
RACES = {"Orc", "Human"}


def spec_table():
    """The SPECS table in app.js: shorthand -> canonical label."""
    src = APP.read_text(encoding="utf-8")
    block = src[src.index("var SPECS = ["):src.index("var SPEC_BY_KEY")]
    pairs = re.findall(r'\["([^"]+)",\s*"([^"]+)",', block)
    shorthand_for = {}
    for short, label in pairs:
        shorthand_for.setdefault(label, []).append(short)
    return shorthand_for


def main():
    loot = json.loads(LOOT.read_text(encoding="utf-8"))
    by_id = {r["id"]: r for r in loot}
    shorthand_for = spec_table()
    known_specs = set(shorthand_for) - RACES

    doc = json.loads(BIS.read_text(encoding="utf-8"))
    specs = doc.get("specs", {})

    errors, warnings = [], []
    entries = 0

    for spec_name, phases in specs.items():
        if spec_name in RACES:
            errors.append(f"{spec_name!r} is a race, not a spec")
            continue
        if spec_name not in known_specs:
            # the likely mistake is using the priority shorthand instead of the label
            label_for = {s.lower(): label
                         for label, shorts in shorthand_for.items() for s in shorts}
            match = label_for.get(spec_name.lower())
            hint = f" - that is the shorthand; use {match!r}" if match else ""
            errors.append(f"{spec_name!r} is not in the SPECS table in app.js{hint}")
            continue

        for phase, items in (phases or {}).items():
            if not re.fullmatch(r"P\d+", phase):
                errors.append(f"{spec_name} / {phase!r}: phase keys look like P3, P4, P5")
            seen = set()

            for entry in items or []:
                entries += 1
                label = f"{spec_name} / {phase}"
                item_id = entry.get("id")

                if item_id is None:
                    errors.append(f"{label}: entry has no id ({entry})")
                    continue
                if item_id in seen:
                    errors.append(f"{label}: id {item_id} listed twice")
                seen.add(item_id)

                rec = by_id.get(item_id)
                if rec is None:
                    errors.append(f"{label}: id {item_id} ({entry.get('item')}) is not in loot_data.json")
                    continue
                if entry.get("item") and entry["item"] != rec["item"]:
                    errors.append(
                        f"{label}: id {item_id} is {rec['item']!r}, but the entry says {entry['item']!r}"
                    )

                tier = entry.get("bis", "phase")
                if tier not in VALID_TIERS:
                    errors.append(f"{label}: {rec['item']} has bis={tier!r}, expected one of {sorted(VALID_TIERS)}")

                # will a ring actually be visible? only if the priority names this spec
                shorthands = shorthand_for.get(spec_name, [])
                pattern = r"\b(?:" + "|".join(re.escape(s) for s in shorthands) + r")\b"
                if not re.search(pattern, rec["priority"], re.I):
                    warnings.append(
                        f"{label}: {rec['item']} - priority {rec['priority']!r} never names "
                        f"{spec_name} ({'/'.join(shorthands)}), so no ring will show"
                    )

    print(f"{entries} entries across {len(specs)} specs")

    if warnings:
        print(f"\nnot visible ({len(warnings)}):")
        for w in warnings:
            print(f"  {w}")

    if errors:
        print(f"\nERRORS ({len(errors)}):")
        for e in errors:
            print(f"  {e}")
        return 1

    print("\nno errors")
    return 0


if __name__ == "__main__":
    sys.exit(main())
