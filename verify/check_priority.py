"""Validate the bundled priority lists in data/lists/ against data/specs.json.

    python verify/check_priority.py

Exits non-zero on any error. This is what makes a typo an error instead of a
silently missing icon, which is the failure mode the old string format had.

It used to read data/loot_data.json, because that is where the priorities lived: zatar's
calls were the substrate the page fell back to. They are a list among lists now, shipped
in data/lists/, and the item data holds no priorities at all - so the rules about
`unsourced` and `prioritySource` went with them. What is left is the shape of a priority,
which is the same wherever it is stored, plus the item-data rules (roles, cloth) that were
always about items rather than about anybody's ranking.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOOT = ROOT / "data" / "loot_data.json"
LISTS = ROOT / "data" / "lists"
SPECS = ROOT / "data" / "specs.json"

# "?" is "not ranked against": these names are listed and nobody has said which comes
# first. It does not advance a position, the way a tie does not.
OPERATORS = {">", ">>", "~>", "=", "~=", "?"}

# Slots you can fill twice at once. Two-Hand is excluded on purpose: you get one
# weapon, not two. Ranged and Relic are single slots, and armour is one each.
DOUBLE_SLOTS = {"Finger", "Trinket", "One-Hand", "Main-Hand", "Off-Hand"}

ROLE_TAGS = {"Physical", "Caster", "Healer", "Tank", "Tier"}

# Armour proficiency: a class wears its own type and everything below it. This is a
# hard rule the editor enforces, so the data must never contradict it.
ARMOUR_RANK = {"Cloth": 1, "Leather": 2, "Mail": 3, "Plate": 4}
RELIC_CLASS = {"Idol": "Druid", "Totem": "Shaman", "Libram": "Paladin"}


def main():
    reg = json.loads(SPECS.read_text(encoding="utf-8"))
    loot = json.loads(LOOT.read_text(encoding="utf-8"))
    specs, classes, races, forms = reg["specs"], reg["classes"], reg["races"], reg["forms"]

    errors, warnings = [], []
    entries = with_priority = 0

    by_id = {}
    for rec in loot:
        where = rec["item"]
        by_id[str(rec["id"])] = rec

        if "priority" in rec or "notes" in rec and not isinstance(rec.get("notes"), str):
            pass
        if "priority" in rec:
            errors.append(f"{where}: the item data carries a priority - those live in "
                          f"data/lists/ now, one file per list")

        # `roles` says what kinds of player an item is for, and drives the editor's
        # smart filtering. A tag is a judgement, so the only thing checkable is that
        # it is present, non-empty, and drawn from the five.
        tags = rec.get("roles")
        if not isinstance(tags, list) or not tags:
            errors.append(f"{where}: roles is {tags!r}, expected a non-empty list")
        else:
            bad = [t for t in tags if t not in ROLE_TAGS]
            if bad:
                errors.append(f"{where}: unknown role tag(s) {bad}, expected from {sorted(ROLE_TAGS)}")
            if len(set(tags)) != len(tags):
                errors.append(f"{where}: roles lists the same tag twice ({tags})")
            # cloth is caster/healer gear; a Physical tag here would put rogues and
            # hunters back on robes in the editor
            if rec.get("type") == "Cloth" and "Physical" in tags:
                errors.append(f"{where}: cloth tagged Physical - no cloth item in this set is")

    # --- the lists that ship with the site --------------------------------------
    for path in sorted(LISTS.glob("*.json")):
        if path.name == "index.json":
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        lname = doc.get("name") or path.name
        for item_id, prio in (doc.get("priorities") or {}).items():
            rec = by_id.get(str(item_id))
            where = f"{lname}: {rec['item'] if rec else item_id}"
            if rec is None:
                warnings.append(f"{where}: item id not in loot_data.json any more")
                continue
            if not isinstance(prio, list):
                errors.append(f"{where}: priority is {type(prio).__name__}, expected a list")
                continue
            if prio:
                with_priority += 1

            seen = set()
            for i, e in enumerate(prio):
                entries += 1
                if not isinstance(e, dict):
                    errors.append(f"{where}[{i}]: entry is {type(e).__name__}, expected an object")
                    continue

                has_spec, has_class = "spec" in e, "class" in e
                if has_spec and has_class:
                    errors.append(f"{where}[{i}]: has both spec and class")
                elif not has_spec and not has_class:
                    errors.append(f"{where}[{i}]: has neither spec nor class")

                if has_spec and e["spec"] not in specs:
                    errors.append(f"{where}[{i}]: unknown spec {e['spec']!r}")
                if has_class and e["class"] not in classes:
                    errors.append(f"{where}[{i}]: unknown class {e['class']!r}")

                if e.get("race") and e["race"] not in races:
                    errors.append(f"{where}[{i}]: unknown race {e['race']!r}")

                if e.get("form"):
                    allowed = forms.get(e.get("spec"), {})
                    if e["form"] not in allowed:
                        errors.append(
                            f"{where}[{i}]: {e.get('spec')} has no form {e['form']!r}"
                            + (f" (has {sorted(allowed)})" if allowed else "")
                        )

                # the operator is what links this entry to the previous one
                if i == 0 and "op" in e:
                    errors.append(f"{where}[0]: first entry must not have an op (got {e['op']!r})")
                if i > 0:
                    if "op" not in e:
                        errors.append(f"{where}[{i}]: missing op")
                    elif e["op"] not in OPERATORS:
                        errors.append(f"{where}[{i}]: unknown op {e['op']!r}, expected one of {sorted(OPERATORS)}")

                # Proficiency is a hard rule the editor applies, so the data must never
                # contradict it: a class wears its own armour type and everything below,
                # and a relic belongs to exactly one class. Tested when this was written,
                # zatar's 398 entries break it zero times.
                named = []
                if has_spec and e["spec"] in specs:
                    cov = specs[e["spec"]].get("covers")
                    named = cov if cov else [e["spec"]]
                elif has_class and e["class"] in classes:
                    named = [k for k, v in specs.items()
                             if v["class"] == e["class"] and not v.get("covers")]
                for s_id in named:
                    cls = specs[s_id]["class"]
                    cap = ARMOUR_RANK.get(classes[cls]["armor"], 9)
                    need = ARMOUR_RANK.get(rec.get("type"))
                    if need and need > cap:
                        errors.append(
                            f"{where}: {s_id} cannot wear {rec['type']} "
                            f"({cls} wears {classes[cls]['armor']} and below)"
                        )
                    owner = RELIC_CLASS.get(rec.get("type"))
                    if owner and cls != owner:
                        errors.append(f"{where}: {s_id} cannot use a {rec['type']} (that is {owner} only)")

                # A spec may only be listed twice if that person could equip two of the
                # item: a ring, a trinket, or a one-handed weapon, and only when the
                # item is not unique. Two-handers, armour and ranged slots can't.
                key = (e.get("spec") or e.get("class"), e.get("form"), e.get("race"))
                if key in seen:
                    if rec.get("unique"):
                        errors.append(
                            f"{where}: {key[0]} listed twice, but the item is unique - "
                            f"only one can be equipped"
                        )
                    elif rec.get("slot") not in DOUBLE_SLOTS:
                        errors.append(
                            f"{where}: {key[0]} listed twice, but a {rec.get('slot')} item "
                            f"can only be equipped once"
                        )
                seen.add(key)

    print(f"{len(loot)} records | {with_priority} with a priority | {entries} entries")

    if warnings:
        print(f"\nworth a look ({len(warnings)}):")
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
