"""Build verify/p1p2-drops.json - which boss drops what, for the Phase 1 and Phase 2 raids.

    python verify/scrape_drops.py            # dry run
    python verify/scrape_drops.py --write    # apply

The Zul'Aman and Sunwell equivalent (p4p5-drops.json) was assembled by hand. At ~340
items across four guides that is the wrong tool, so the scrape is a script and the
script is the audit trail - the same relationship fetch_bis.py has with bis.json.

Each guide lists its loot under per-boss headings. HEADINGS is the reviewed part: it
maps what Wowhead calls a section onto the boss names in app.js's BOSS_ORDER, and it is
where the guides' irregularities live. An unmapped heading is an ERROR, not a skip -
a silent skip is how a whole boss goes missing and nobody notices.

Nothing here decides what an item IS. Name, slot, type, quality and unique-equipped all
come from the item database in fetch_items.py, which is also where non-epics are dropped.
"""

import json
import re
import sys
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
OUT = HERE / "p1p2-drops.json"
UA = {"User-Agent": "loot-prio/1.0"}
BASE = "https://www.wowhead.com/tbc/guide/"

# One guide per page, and a page can serve two zones - Gruul's Lair and Magtheridon's
# Lair share one. Which zone a section belongs to comes from HEADINGS, not from here.
GUIDES = [
    "karazhan-raid-loot-gear-tier-tokens-burning-crusade-classic",
    "gruuls-lair-and-magtheridons-lair-loot-guide-for-world-of-warcraft-burning-13462",
    "serpentshrine-cavern-ssc-loot-gear-guide-burning-crusade-classic",
    "the-eye-raid-gear-loot-burning-crusade-classic-wow",
]

# heading as Wowhead writes it -> (zone, boss) exactly as app.js spells them.
# The awkward ones, and why:
#   "Grull the Dragonkiller"   - Wowhead's typo, and it is on the live page
#   "Hydross The Unstable"     - capital T where BOSS_ORDER has a lower-case one
#   "Opera Event - Shared"     - the three Opera outcomes share a loot table
#   Servant's Quarters         - three rare spawns, folded into one Basement card
HEADINGS = {
    "Attumen the Huntsman": ("Karazhan", "Attumen the Huntsman"),
    "Moroes": ("Karazhan", "Moroes"),
    "Maiden of Virtue": ("Karazhan", "Maiden of Virtue"),
    "Opera Event - Shared": ("Karazhan", "Opera Event"),
    "The Curator": ("Karazhan", "The Curator"),
    "Terestian Illhoof": ("Karazhan", "Terestian Illhoof"),
    "Shade of Aran": ("Karazhan", "Shade of Aran"),
    "Netherspite": ("Karazhan", "Netherspite"),
    "Chess Event": ("Karazhan", "Chess Event"),
    "Prince Malchezaar": ("Karazhan", "Prince Malchezaar"),
    "Nightbane": ("Karazhan", "Nightbane"),
    "Servant's Quarters - Hyakiss the Lurker": ("Karazhan", "Basement"),
    "Servant's Quarters - Rokad the Ravager": ("Karazhan", "Basement"),
    "Servant's Quarters - Shadikith the Glider": ("Karazhan", "Basement"),
    "Loot from Trash Mobs in TBC Classic Karazhan": ("Karazhan", "Trash"),

    "High King Maulgar": ("Gruul's Lair", "High King Maulgar"),
    "Grull the Dragonkiller": ("Gruul's Lair", "Gruul the Dragonkiller"),
    "Magtheridon": ("Magtheridon's Lair", "Magtheridon"),

    "Hydross The Unstable": ("Serpentshrine Cavern", "Hydross the Unstable"),
    "The Lurker Below": ("Serpentshrine Cavern", "The Lurker Below"),
    "Leotheras the Blind": ("Serpentshrine Cavern", "Leotheras the Blind"),
    "Fathom-Lord Karathress": ("Serpentshrine Cavern", "Fathom-Lord Karathress"),
    "Morogrim Tidewalker": ("Serpentshrine Cavern", "Morogrim Tidewalker"),
    "Lady Vashj": ("Serpentshrine Cavern", "Lady Vashj"),
    "Trash Mob Loot": ("Serpentshrine Cavern", "Trash"),

    "Al'ar": ("Tempest Keep", "Al'ar"),
    "Void Reaver": ("Tempest Keep", "Void Reaver"),
    "High Astromancer Solarian": ("Tempest Keep", "High Astromancer Solarian"),
    "Kael'thas Sunstrider": ("Tempest Keep", "Kael'thas Sunstrider"),
    "Loot from Trash Mobs in Tempest Keep in TBC Classic": ("Tempest Keep", "Trash"),
}

# Sections that are deliberately not loot: recipes and patterns (excluded on the same
# grounds CLAUDE.md section 7 excludes gems), the summary table at the top of a guide,
# and reader comments, which contain item links like everything else.
IGNORE = re.compile(
    r"^(Profession Recipes|Profession Recipes and Patterns|All Loot from|"
    r"Comment by|Contribute|.*Item Level Drops|.*Tier Set Armor)", re.I)

HEAD = re.compile(r"<h[23][^>]*>(.*?)</h[23]>", re.S)
SPLIT = re.compile(r"<h[23][^>]*>(.*?)</h[23]>", re.S)
ITEM = re.compile(r"/tbc/item=(\d+)")
TAGS = re.compile(r"<[^>]+>")


def get(slug):
    req = urllib.request.Request(BASE + slug, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.read().decode("utf-8", "replace")


def sections(html):
    """(heading text, item ids under it) for every heading on the page, in order."""
    parts = SPLIT.split(html)
    for i in range(1, len(parts), 2):
        name = TAGS.sub("", parts[i]).strip()
        # &#39; and friends: the headings carry apostrophes and Wowhead escapes them
        name = (name.replace("&#39;", "'").replace("&amp;", "&")
                    .replace("&#x27;", "'").replace("&rsquo;", "’"))
        ids = list(dict.fromkeys(int(m) for m in ITEM.findall(parts[i + 1])))
        yield name, ids


def main():
    write = "--write" in sys.argv
    drops, unmapped, empty = {}, [], []

    for slug in GUIDES:
        html = get(slug)
        for name, ids in sections(html):
            if IGNORE.match(name):
                continue
            if name not in HEADINGS:
                # only complain about a heading that actually carried loot; a guide has
                # plenty of prose headings and they are not the failure being guarded
                if ids:
                    unmapped.append(f"{slug}: {name!r} ({len(ids)} items)")
                continue
            zone, boss = HEADINGS[name]
            if not ids:
                empty.append(f"{zone} / {boss}")
                continue
            # Basement is three sections folded into one card, so ids accumulate
            have = drops.setdefault(zone, {}).setdefault(boss, [])
            for i in ids:
                if i not in have:
                    have.append(i)

    total = sum(len(v) for z in drops.values() for v in z.values())
    print(f"{total} drop entries across {len(drops)} zones\n")
    for zone in drops:
        print(f"  {zone}")
        for boss, ids in drops[zone].items():
            print(f"    {len(ids):4}  {boss}")

    if empty:
        print(f"\nmapped but carried no items ({len(empty)}):")
        for e in empty:
            print(f"  {e}")

    # A heading this table has never seen is a boss going missing in silence, which is
    # the one failure mode a scrape like this has. Refuse rather than write a short file.
    if unmapped:
        print(f"\nUNMAPPED HEADINGS ({len(unmapped)}) - add them to HEADINGS or IGNORE:")
        for u in unmapped:
            print(f"  {u}")
        return 1

    if not write:
        print("\ndry run - pass --write to apply")
        return 0

    doc = {"note": (
        "Which boss drops what, for the Phase 1 and Phase 2 raids. Built by "
        "verify/scrape_drops.py from Wowhead's per-raid loot guides - run that rather than "
        "editing this by hand. Item ids only: name, slot, type, quality and unique-equipped "
        "all come from the item database in fetch_items.py, which also drops anything below "
        "epic. Karazhan's three Servant's Quarters rare spawns - Hyakiss, Rokad and "
        "Shadikith - are folded into one 'Basement' source: they are rare spawns rather "
        "than Encounter Journal bosses, they have no portrait art, and the loot question is "
        "which source rather than which spawn. Recipes and patterns are excluded, on the "
        "same grounds CLAUDE.md section 7 excludes gems. The Opera Event's three outcomes "
        "share one loot table and Wowhead lists it once, as 'Opera Event - Shared'.")}
    doc.update(drops)
    OUT.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nwrote {OUT.relative_to(HERE.parent)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
