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
SPECS = ROOT / "data" / "specs.json"

VALID_TIERS = {"phase", "multiPhase", "expansion"}
RACES = {"Orc", "Human"}


def registry():
    """Identifiers the BiS file may use: every spec and class in specs.json."""
    reg = json.loads(SPECS.read_text(encoding="utf-8"))
    return reg["specs"], reg["classes"], reg["aliases"]


def main():
    loot = json.loads(LOOT.read_text(encoding="utf-8"))
    by_id = {r["id"]: r for r in loot}
    reg_specs, reg_classes, aliases = registry()
    known_specs = set(reg_specs) | set(reg_classes)

    doc = json.loads(BIS.read_text(encoding="utf-8"))
    bis_specs = doc.get("specs", {})

    errors, warnings = [], []
    entries = 0

    for spec_name, phases in bis_specs.items():
        if spec_name not in known_specs:
            # likely mistakes: the old display label, or the priority shorthand
            by_name = {v["name"].lower(): k
                       for k, v in list(reg_specs.items()) + list(reg_classes.items())}
            alias = {k.lower(): v for k, v in aliases.items()}
            match = by_name.get(spec_name.lower())
            if match is None:
                target = alias.get(spec_name.lower())
                match = target.get("spec") if isinstance(target, dict) else target
            hint = f" - use the identifier {match!r}" if match else ""
            errors.append(f"{spec_name!r} is not in data/specs.json{hint}")
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

                # Will a ring actually be visible? Only if the priority lists this
                # spec. An exact membership test now that priority is structured -
                # this used to be a regex over prose.
                listed = {e.get("spec") or e.get("class") for e in rec.get("priority", [])}
                if spec_name not in listed:
                    shown = ", ".join(sorted(x for x in listed if x)) or "nobody"
                    warnings.append(
                        f"{label}: {rec['item']} - priority lists {shown}, "
                        f"not {spec_name}, so no ring will show"
                    )

    print(f"{entries} entries across {len(bis_specs)} specs")

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
