"""Build one set of zones' rows in data/loot_data.json, from a drops file.

    python verify/fetch_items.py                              # dry run, Zul'Aman + Sunwell
    python verify/fetch_items.py --write                      # apply
    python verify/fetch_items.py --drops p1p2-drops.json      # the Phase 1 and 2 raids

The drops file says which boss drops what - the one thing a machine cannot
infer from an item id, and the one most likely to be wrong, so it is a reviewed file
of its own rather than something this script decides. Everything else comes from the
item database: name, slot, type, quality and unique-equipped.

Only the zones named in the drops file are rewritten, so pointing this at one file
leaves every other phase's rows exactly as they are.

Anything below epic is dropped and REPORTED by name. The raid loot guides list recipes
and patterns beside the gear, and this dataset is epic-and-above - which is also a live
invariant rather than a preference: the accent is green, and green is uncommon quality,
so the palette is only unambiguous while no item name ever renders in it (CLAUDE.md
section 4).

`roles` is seeded here from the item's own stats and is deliberately the weakest part:
it is a judgement, and the guide's BiS lists are the better source. Run this, then
fetch_bis.py for P4/P5, then re-seed roles from what the specs actually call BiS. The
stat rule is the fallback for items no spec lists at all.

`priority` is empty and `unsourced` is true on every row: zatar's videos covered Black
Temple and Mount Hyjal, and never these two raids. That is a fact about the guide, not
a gap to fill in.
"""

import json
import re
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOOT = ROOT / "data" / "loot_data.json"
HERE = Path(__file__).resolve().parent
TIP = "https://nether.wowhead.com/tbc/tooltip/item/{}"
UA = {"User-Agent": "loot-prio/1.0"}

BIND = re.compile(r"Binds when", re.I)
# "Unique" and "Unique-Equipped" sit between the bind line and the slot, so they have
# to be stepped over rather than mistaken for one.
SKIP = re.compile(r"^(Unique|Unique-Equipped.*|Conjured Item)$", re.I)
UNIQUE = re.compile(r"<br\s*/?>\s*Unique(-Equipped)?\b", re.I)

SLOT = {"Main Hand": "Main-Hand", "Off Hand": "Off-Hand", "Held In Off-hand": "Off-Hand",
        "Held in Off-hand": "Off-Hand", "Thrown": "Ranged"}
BY_SLOT = {"Finger": "Ring", "Neck": "Neck", "Trinket": "Trinket", "Back": "Cloak"}
# stored bare: app.js's BARE_WEAPON adds "1H "/"2H " from the slot at render time, so
# the data does not have to carry a hand count the slot already settles.
TYPE = {"Fist Weapon": "Fist"}

# Wowhead's quality ladder. 4 is epic, 5 legendary - this dataset holds nothing below.
MIN_QUALITY = 4
QUALITY_NAME = {0: "poor", 1: "common", 2: "uncommon", 3: "rare",
                4: "epic", 5: "legendary", 6: "artifact"}

# Armour tokens report no slot at all - the tooltip lists the classes instead. Which
# slot each becomes, and which three classes it serves, are fixed by the game.
TOKEN_SLOT = {"Bracers": "Wrist", "Belt": "Waist", "Boots": "Feet", "Pauldrons": "Shoulder",
              "Chestguard": "Chest", "Gloves": "Hands", "Helm": "Head", "Leggings": "Legs"}
# The three class groupings, per tier set. T4 (Fallen) and T5 (Vanquished) share one
# set of groupings and T6 (Forgotten) uses a different one - Priest is with Warlock at
# T6 and with Warrior at T4/T5 - so these cannot be collapsed into one table however
# much they look alike. Read off the tooltips' own "Classes:" lines, not from memory.
TOKEN_SET = {
    ("Forgotten", "Conqueror"): "Tier Token (Pal/Priest/Lock)",
    ("Forgotten", "Protector"): "Tier Token (War/Hunter/Shaman)",
    ("Forgotten", "Vanquisher"): "Tier Token (Rogue/Mage/Druid)",
    ("Fallen", "Champion"): "Tier Token (Pal/Rogue/Shaman)",
    ("Fallen", "Defender"): "Tier Token (War/Priest/Druid)",
    ("Fallen", "Hero"): "Tier Token (Hunter/Mage/Lock)",
    ("Vanquished", "Champion"): "Tier Token (Pal/Rogue/Shaman)",
    ("Vanquished", "Defender"): "Tier Token (War/Priest/Druid)",
    ("Vanquished", "Hero"): "Tier Token (Hunter/Mage/Lock)",
}

# What a wearable item's slot looks like. Anything else the tooltip parse produced is
# not gear: a pattern reports "Requires", a mount "Mount", a quest item "This Item
# Begins a Quest". Epic quality does not separate these - Pattern: Soulcloth Vest is a
# purple - so the test is whether the thing can be equipped at all.
EQUIP_SLOTS = {"Head", "Neck", "Shoulder", "Back", "Chest", "Wrist", "Hands", "Waist",
               "Legs", "Feet", "Finger", "Trinket", "Main-Hand", "Off-Hand", "One-Hand",
               "Two-Hand", "Ranged", "Relic"}


# A few hundred item lookups per run, one request each. Without a cache on disk an
# interrupted run - a laptop sleeping, a flaky connection - starts again from zero and
# asks Wowhead for everything a second time, which is how fetch_bis.py earned a string
# of 403s. Every answer is kept, so a re-run costs Wowhead nothing and resumes where it
# stopped. Delete the directory to force a refresh.
CACHE_DIR = Path(tempfile.gettempdir()) / "loot-prio-item-cache"


def get(item_id):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    cached = CACHE_DIR / f"{item_id}.json"
    if cached.exists():
        return json.loads(cached.read_text(encoding="utf-8"))

    # one retry: a dropped connection mid-run is the common case, not a missing item
    last = None
    for attempt in range(3):
        try:
            req = urllib.request.Request(TIP.format(item_id), headers=UA)
            with urllib.request.urlopen(req, timeout=25) as r:
                body = r.read().decode("utf-8", "replace")
            doc = json.loads(body)
            cached.write_text(body, encoding="utf-8")
            return doc
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            last = e
            time.sleep(2 * (attempt + 1))
    raise RuntimeError(f"item {item_id}: {last}")


def flatten(tooltip):
    t = re.sub(r"\|+", "|", re.sub(r"<[^>]+>", "|", tooltip))
    return [p.strip() for p in t.split("|") if p.strip()]


def slot_type(name, tooltip):
    m = re.match(r"^(\w+) of the (Forgotten|Fallen|Vanquished) (\w+)$", name)
    if m and (m.group(2), m.group(3)) in TOKEN_SET:
        return TOKEN_SLOT.get(m.group(1), ""), TOKEN_SET[(m.group(2), m.group(3))]

    parts = flatten(tooltip)
    i = next((k for k, p in enumerate(parts) if BIND.match(p)), None)
    if i is None:
        return "", ""
    rest = [p for p in parts[i + 1:] if not SKIP.match(p)]
    raw_slot = rest[0] if rest else ""
    raw_type = rest[1] if len(rest) > 1 else ""
    slot = SLOT.get(raw_slot, raw_slot)
    if slot in BY_SLOT:
        return slot, BY_SLOT[slot]
    return slot, TYPE.get(raw_type, raw_type)


# Seeded from the stats an item actually carries. Blunt on hybrids by design - the BiS
# lists are the real source and this is what covers the items no spec lists.
def roles_from_stats(tooltip, item_type):
    if item_type.startswith("Tier Token"):
        return ["Tier"]
    body = " ".join(flatten(tooltip)).lower()
    out = []
    if any(k in body for k in ("defense rating", "dodge rating", "parry rating",
                               "block value", "block rating", "increases the block")):
        out.append("Tank")
    heal = any(k in body for k in ("mana per 5", "mana every 5", "healing spells", "spirit"))
    caster = any(k in body for k in ("spell damage", "spell power", "spell critical",
                                     "spell hit", "damage and healing", "intellect"))
    if heal:
        out.append("Healer")
    if caster:
        out.append("Caster")
    if any(k in body for k in ("strength", "agility", "attack power", "expertise",
                               "armor penetration", "critical strike rating")) \
            and item_type != "Cloth":
        out.append("Physical")
    # every row needs at least one, and armour class is the last resort
    if not out:
        out = ["Caster"] if item_type == "Cloth" else ["Physical"]
    return out


def drops_path(argv):
    if "--drops" in argv:
        name = argv[argv.index("--drops") + 1]
        # a bare filename means "in verify/", which is where all of them live
        return Path(name) if "/" in name else HERE / name
    return HERE / "p4p5-drops.json"


def main():
    write = "--write" in sys.argv
    path = drops_path(sys.argv)
    print(f"reading {path.name}\n")
    drops = json.loads(path.read_text(encoding="utf-8"))
    zones = [z for z in drops if z != "note"]

    # A record carries one boss, so an item two bosses drop needs the other named
    # somewhere. The Eredar Twins can drop any armour token from an earlier boss,
    # which is a real mechanic and worth saying rather than losing.
    also = {}
    for zone in zones:
        seen_z = {}
        for boss, ids in drops[zone].items():
            for item_id in ids:
                if item_id in seen_z:
                    also.setdefault(item_id, []).append(boss)
                else:
                    seen_z[item_id] = boss

    seen, rows, problems, skipped = {}, [], [], []
    for zone in zones:
        for boss, ids in drops[zone].items():
            for item_id in ids:
                if item_id in seen:
                    continue
                seen[item_id] = boss
                doc = get(item_id)
                quality = doc.get("quality", 0)
                if quality < MIN_QUALITY:
                    skipped.append(f"{item_id} {doc['name']} "
                                   f"({QUALITY_NAME.get(quality, quality)}, {zone} / {boss})")
                    time.sleep(0.1)
                    continue
                slot, typ = slot_type(doc["name"], doc["tooltip"])
                if not slot or not typ:
                    problems.append(f"{item_id} {doc['name']}: slot/type unresolved")
                    continue
                # a token reports its classes rather than a slot, and is resolved above
                if slot not in EQUIP_SLOTS and not typ.startswith("Tier Token"):
                    skipped.append(f"{item_id} {doc['name']} (not equippable: "
                                   f"slot read as {slot!r}, {zone} / {boss})")
                    continue
                rec = {
                    "zone": zone, "boss": boss, "item": doc["name"], "id": item_id,
                    "wowhead": f"https://www.wowhead.com/tbc/item={item_id}",
                    "slot": slot, "type": typ,
                    "roles": roles_from_stats(doc["tooltip"], typ),
                    "priority": [],
                    "notes": ("Also drops from " + " and ".join(also[item_id]) + "."
                              if item_id in also else ""),
                    "unsourced": True,
                }
                if UNIQUE.search(doc["tooltip"]):
                    rec["unique"] = True
                rows.append(rec)
                time.sleep(0.1)

    print(f"{len(rows)} rows built across {len(zones)} zones")
    if skipped:
        print(f"\nnot gear, dropped ({len(skipped)}):")
        for k in skipped:
            print(f"  {k}")
    if problems:
        print(f"\nworth a look ({len(problems)}):")
        for p in problems:
            print(f"  {p}")

    if not write:
        print("\ndry run - pass --write to apply")
        return 0

    loot = json.loads(LOOT.read_text(encoding="utf-8"))
    loot = [r for r in loot if r["zone"] not in zones] + rows
    LOOT.write_text(json.dumps(loot, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nwrote {LOOT} - {len(loot)} records")
    return 0


if __name__ == "__main__":
    sys.exit(main())
