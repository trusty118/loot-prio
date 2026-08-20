"""Validate data/bis.json against the loot table and the spec table in app.js.

Usage:
    python verify/check_bis.py              # errors, plus a one-line summary
    python verify/check_bis.py --verbose    # and every not-visible entry

Exits non-zero on errors. "Not visible" is not an error and not a defect: the guide's
priority is coarser than per-spec BiS - he never mentions Marksmanship, for instance -
so an item can be BiS for a spec his line never names, and no icon exists to ring.
That is expected and must stay that way: the priority is his ordering, destined to be
a loadable template, and is never augmented from bis.json.
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

    errors, warnings, warn_ids = [], [], set()
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

                # Will a ring actually be visible? The renderer draws one when the
                # priority names this spec, or names its class - a class icon
                # carries the rings of the specs behind it. So a warning here means
                # neither is listed, and nothing on the row can hold the mark.
                listed = {e.get("spec") or e.get("class") for e in rec.get("priority", [])}
                owner = reg_specs.get(spec_name, {}).get("class")
                # an umbrella spec in the priority (FeralDruid) shows the rings of
                # the specs it covers, so it counts as this spec being listed
                umbrellas = {s for s, v in reg_specs.items() if spec_name in (v.get("covers") or [])}
                if spec_name not in listed and not (umbrellas & listed) \
                        and (owner is None or owner not in listed):
                    shown = ", ".join(sorted(x for x in listed if x)) or "nobody"
                    who = spec_name if owner is None else f"{spec_name} or {owner}"
                    warn_ids.add(item_id)
                    warnings.append(
                        f"{label}: {rec['item']} - priority lists {shown}, "
                        f"not {who}, so no ring will show"
                    )

    print(f"{entries} entries across {len(bis_specs)} specs")

    if warnings:
        verbose = "--verbose" in sys.argv
        items = len(warn_ids)
        print()
        note = "" if verbose else " (--verbose to list them)"
        print(f"{len(warnings)} entries across {items} items are not visible on the "
              f"guide's priority - expected, his ordering is coarser than per-spec BiS"
              + note)
        if verbose:
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
