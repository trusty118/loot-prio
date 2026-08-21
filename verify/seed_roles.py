"""Seed the multi-valued `roles` tag on every record in data/loot_data.json.

    python3 verify/seed_roles.py            # dry run, prints the review list
    python3 verify/seed_roles.py --write    # apply
    python3 verify/seed_roles.py --only Cloth Plate

`role` was one coarse word per item. `roles` is a list, because an item can serve
more than one kind of player - a plate piece can be both caster and tank gear, and a
ring can be worn by a healer and a shadow priest alike. The editor uses it to stop
offering specs an item was never meant for.

Two sources feed the seed, in order:

  1. data/bis.json. The specs that call an item BiS say what it is for, so the union
     of their `roles` from specs.json is direct evidence. 116 items have this.
  2. the existing `role` field, for the 79 items no guide ranks.

Where the two disagree the union is proposed and the item is FLAGGED, because a
disagreement is usually the interesting case: Legionkiller reads Physical but is BiS
for a Prot Warrior. Nothing is written without --write, and the flags are meant to be
read by a person first.

This never touches `priority`: those are zatar's calls.
"""

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOOT = ROOT / "data" / "loot_data.json"
SPECS = ROOT / "data" / "specs.json"
BIS = ROOT / "data" / "bis.json"

VALID = ["Physical", "Caster", "Healer", "Tank", "Tier"]
ARMOUR = {"Cloth", "Leather", "Mail", "Plate"}


def order(roles):
    """A stable order, so a re-run never produces a diff of shuffled lists."""
    return [r for r in VALID if r in roles]


def main():
    write = "--write" in sys.argv
    only = []
    if "--only" in sys.argv:
        only = [a for a in sys.argv[sys.argv.index("--only") + 1:] if not a.startswith("--")]

    loot = json.loads(LOOT.read_text(encoding="utf-8"))
    specs = json.loads(SPECS.read_text(encoding="utf-8"))["specs"]
    bis = json.loads(BIS.read_text(encoding="utf-8"))["specs"]

    # which specs call each item BiS
    by_item = {}
    for spec, phases in bis.items():
        for entries in phases.values():
            for e in entries:
                by_item.setdefault(e["id"], set()).add(spec)

    flagged, from_bis, from_role, cloth_watch = [], 0, 0, []

    for rec in loot:
        if only and rec.get("type") not in only:
            continue

        old = rec.get("role")
        evidence = by_item.get(rec["id"], set())
        derived = set()
        for s in evidence:
            derived |= set(specs.get(s, {}).get("roles", []))

        if derived:
            from_bis += 1
            roles = order(derived | ({old} if old else set()))
            if old and old not in derived:
                flagged.append((rec, old, sorted(derived), sorted(evidence)))
        else:
            from_role += 1
            roles = order({old} if old else set())

        if not roles:                       # nothing to go on - leave the old value alone
            roles = [old] if old else []

        rec["roles"] = roles

        if rec.get("type") == "Cloth" and "Physical" in roles:
            cloth_watch.append(rec["item"])

    # rebuild each record so `roles` sits exactly where `role` did, and `role` goes
    for i, rec in enumerate(loot):
        if "roles" not in rec:
            continue
        out = {}
        for k, v in rec.items():
            if k == "role":
                out["roles"] = rec["roles"]
            elif k != "roles":
                out[k] = v
        loot[i] = out

    tagged = [r for r in loot if "roles" in r]
    print(f"{len(tagged)} records tagged | {from_bis} from BiS evidence, {from_role} from `role` alone")

    multi = [r for r in tagged if len(r["roles"]) > 1]
    print(f"{len(multi)} carry more than one tag")
    for r in multi[:12]:
        print(f"    {r['item'][:34]:<34} {r['type']:<10} {r['roles']}")
    if len(multi) > 12:
        print(f"    ... and {len(multi) - 12} more")

    if flagged:
        print(f"\nREVIEW THESE ({len(flagged)}) - the guides disagree with the old `role`:")
        for rec, old, derived, evidence in flagged:
            print(f"    {rec['item'][:34]:<34} {rec['type']:<10} was {old!r}, guides say {derived}")
            print(f"    {'':<34} because these call it BiS: {', '.join(evidence[:6])}")

    if cloth_watch:
        print(f"\nCLOTH TAGGED PHYSICAL ({len(cloth_watch)}) - no such item should exist:")
        for item in cloth_watch:
            print(f"    {item}")

    if not write:
        print("\nDry run. Nothing written. Re-run with --write once the list above reads right.")
        return 0

    LOOT.write_text(json.dumps(loot, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {LOOT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
