"""One-shot migration: priority strings -> ordered structure.

    python verify/migrate_priority.py            # dry run, shows every change
    python verify/migrate_priority.py --write    # apply

Refuses to write unless every token in every record resolves against
data/specs.json. Kept in the repo as the audit trail for how the conversion was
done, in the same spirit as verify/apply.py.
"""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOOT = ROOT / "data" / "loot_data.json"
SPECS = ROOT / "data" / "specs.json"

# The three records whose operators were a judgement call. Daniel's decisions:
#   Stormrage Signet Ring - keeps ">>" now that it is a real operator
#   Fist of Molten Fury   - the bare "~" prefix becomes a "~=" link
#   Zhar'doom             - ">=" ("at least as good as") becomes "~>"
OVERRIDES = {
    32945: [  # Fist of Molten Fury: was "~Rogue = Hunter"
        {"class": "Rogue"},          # Rogue and Hunter are classes, not specs
        {"class": "Hunter", "op": "~="},
    ],
    32374: [  # Zhar'doom: was "SPriest >= Lock = Mage = Boomkin = Ele"
        {"spec": "ShadowPriest"},
        {"class": "Warlock", "op": "~>"},
        {"class": "Mage", "op": "="},
        {"spec": "BalanceDruid", "op": "="},
        {"spec": "EleShaman", "op": "="},
    ],
}

EXTRA_NOTES = {
    32945: "Roughly equal.",
    32374: ("Shadow Priest is only slightly ahead, due to being shafted for most of the "
            "expansion on loot, and this will buff your mage/healer group."),
    32497: "Much better for Rogue and Enhance than the rest.",   # Stormrage Signet Ring
}

OPS = {">>": ">>", ">": ">", "=": "="}
SPLIT = re.compile(r"\s*(>>|>|=)\s*")


def resolve(token, reg, where):
    """One operand -> a priority entry, or raise."""
    aliases, specs, classes, races = reg["aliases"], reg["specs"], reg["classes"], reg["races"]
    entry, text = {}, token.strip()

    for race in races:
        if re.match(rf"^{race}\s+", text, re.I):
            entry["race"] = race
            text = text[len(race):].strip()
            break

    key = next((k for k in aliases if k.lower() == text.lower()), None)
    if key is None:
        raise SystemExit(f"UNRESOLVED token {text!r} in {where} - not in specs.json aliases")

    target = aliases[key]
    if isinstance(target, dict):
        entry["spec"] = target["spec"]
        entry["form"] = target["form"]
    elif target in specs:
        entry["spec"] = target
    elif target in classes:
        entry["class"] = target
    else:
        raise SystemExit(f"alias {key!r} points at unknown id {target!r}")
    return entry


def convert(rec, reg):
    text = (rec.get("priority") or "").strip()
    if rec["id"] in OVERRIDES:
        return [dict(e) for e in OVERRIDES[rec["id"]]]
    if not text:
        return []

    parts = SPLIT.split(text)
    out = [resolve(parts[0], reg, rec["item"])]
    for i in range(1, len(parts), 2):
        op, operand = parts[i], parts[i + 1]
        entry = resolve(operand, reg, rec["item"])
        entry["op"] = OPS[op]
        out.append(entry)
    return out


def render(entries):
    """Compact one-line form, for the dry-run diff."""
    bits = []
    for e in entries:
        if e.get("op"):
            bits.append(e["op"])
        name = e.get("spec") or e.get("class")
        if e.get("form"):
            name += f"({e['form']})"
        if e.get("race"):
            name = f"{e['race']}-{name}"
        bits.append(name)
    return " ".join(bits) or "(none)"


def main():
    write = "--write" in sys.argv
    reg = json.loads(SPECS.read_text(encoding="utf-8"))
    loot = json.loads(LOOT.read_text(encoding="utf-8"))

    converted, changed_notes = 0, 0
    for rec in loot:
        if isinstance(rec.get("priority"), list):
            raise SystemExit(f"{rec['item']} is already migrated - nothing to do")
        before = rec["priority"]
        entries = convert(rec, reg)
        if entries:
            converted += 1
        print(f"  {rec['item'][:38]:38} {before[:46]:46} -> {render(entries)}")
        rec["priority"] = entries

        extra = EXTRA_NOTES.get(rec["id"])
        if extra and extra not in rec["notes"]:
            rec["notes"] = (rec["notes"].rstrip() + " " + extra).strip()
            changed_notes += 1

    print(f"\n{len(loot)} records | {converted} with a priority | "
          f"{len(loot) - converted} empty | {changed_notes} notes appended")

    if not write:
        print("\nDry run. Re-run with --write to apply.")
        return 0

    LOOT.write_text(json.dumps(loot, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"\nWrote {LOOT.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
