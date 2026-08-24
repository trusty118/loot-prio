"""Validate the priority lists in data/loot_data.json against data/specs.json.

    python verify/check_priority.py

Exits non-zero on any error. This is what makes a typo an error instead of a
silently missing icon, which is the failure mode the old string format had.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOOT = ROOT / "data" / "loot_data.json"
SPECS = ROOT / "data" / "specs.json"

OPERATORS = {">", ">>", "~>", "=", "~="}

# Slots you can fill twice at once. Two-Hand is excluded on purpose: you get one
# weapon, not two. Ranged and Relic are single slots, and armour is one each.
DOUBLE_SLOTS = {"Finger", "Trinket", "One-Hand", "Main-Hand", "Off-Hand"}

ROLE_TAGS = {"Physical", "Caster", "Healer", "Tank", "Tier"}

# Where an ordering came from, when it did not come from the guide. Absent is the
# ordinary case and means zatar's own call - which is why it must stay absent on the
# 182 rows that are his.
PRIORITY_SOURCES = {"bis"}

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

    for rec in loot:
        where = rec["item"]
        prio = rec.get("priority")

        if not isinstance(prio, list):
            errors.append(f"{where}: priority is {type(prio).__name__}, expected a list")
            continue
        if prio:
            with_priority += 1

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

        # Two different things look like an empty priority, and must not be confused:
        # the creator saying "whoever needs it" (his reasoning is in the notes), and
        # an item he never covered at all (marked unsourced, from the BiS audit).
        # An empty list with neither says nothing at all - a warning rather than an
        # error, because the fix is to go back to the source video, and inventing a
        # note would be worse than leaving the gap visible.
        if not prio and not rec.get("unsourced") and not rec.get("notes"):
            warnings.append(
                f"{where}: empty priority and no notes - the guide's wording for this "
                f"one was never recorded"
            )
        # The marker means "the guide gave no call", so a call contradicts it - unless
        # the record says where the call came from instead. Zul'Aman and Sunwell are
        # outside the guide entirely, and their rows are seeded from the BiS lists so the
        # priority column is not blank on 173 items; `prioritySource` is what keeps that
        # from reading as one of his orderings. An unsourced row with a priority and NO
        # source is still an error, which is the case this was written for.
        source = rec.get("prioritySource")
        if rec.get("unsourced") and prio and not source:
            errors.append(
                f"{where}: marked unsourced but has a priority and no prioritySource - "
                f"either drop the marker or say where the ordering came from")
        if source and source not in PRIORITY_SOURCES:
            errors.append(
                f"{where}: prioritySource={source!r}, expected one of {sorted(PRIORITY_SOURCES)}")
        if source and not rec.get("unsourced"):
            errors.append(
                f"{where}: has prioritySource={source!r} but is not marked unsourced - "
                f"the guide's own calls carry no source, that is what the default means")

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
