"""Build data/bis.json from Wowhead's Phase 3 BiS guides.

    python verify/fetch_bis.py                 # dry run, all specs
    python verify/fetch_bis.py --write         # apply
    python verify/fetch_bis.py --only Arcane ProtWarr

The loot priorities in this repo are zatar_wow's. BiS is a separate layer on top,
and this is where it comes from: verify/bis-sources.json names one Wowhead Phase 3
guide per spec, and their gear tables rank each row "BiS" or "Option". We keep the
BiS rows, and only those whose item this site actually lists - a guide naming a
Sunwell drop or a badge vendor item is reported and dropped, never added.

How long an item stays BiS is derived rather than guessed: if it is still in that
spec's wowsims/tbc P4 preset it is multiPhase, and if it survives to P5 it lasted
the expansion. Specs with no wowsims preset (most healers) stay at phase, which is
the file's default.

data/loot_data.json is READ ONLY here. It supplies the id set to intersect against
and the names to cross-check; nothing in this script writes a priority.
"""

import json
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LOOT = ROOT / "data" / "loot_data.json"
SPECS = ROOT / "data" / "specs.json"
BIS = ROOT / "data" / "bis.json"
SOURCES = Path(__file__).resolve().parent / "bis-sources.json"

WOWSIMS = "https://raw.githubusercontent.com/wowsims/tbc/master/ui/{}/presets.ts"
UA = {"User-Agent": "loot-prio/1.0"}

# the guide's gear tables start under this heading
BIS_HEADING = re.compile(r"Best In Slot Gear.{0,80}?Phase\s*3", re.I | re.S)

ROW = re.compile(r"<tr.*?</tr>", re.S)
CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
ITEM_LINK = re.compile(r"/tbc/item=(\d+)[^>]*>(.*?)</a>", re.S)
TAGS = re.compile(r"<[^>]+>")

# Each gear row is ranked in the guide's first column, and the vocabulary is not
# fixed: 140 rows across 14 guides say "BiS", but tank guides rank by purpose
# ("Best Threat", "Best Mitigation") and healers by build ("Regen BiS",
# "BiS - Haste"). So: keep a row whose rank leads with "Best" or names "BiS"
# anywhere, unless it is qualified into something that is not this phase's answer.
# "Near Best" and "Second Best" fail the leading-word test on purpose.
RANKED_BIS = re.compile(r"^best\b|\bbis\b", re.I)
NOT_BIS = re.compile(
    r"alternative|option|pre-?raid|pvp|seasonal|phase\s*2|^p2\b|until tier|second",
    re.I,
)

TIERS = {1: "phase", 2: "multiPhase", 3: "expansion"}


def get(url, as_json=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=30) as r:
        raw = r.read().decode("utf-8", "replace")
    time.sleep(0.15)   # be polite
    return json.loads(raw) if as_json else raw


def text(html):
    return re.sub(r"\s+", " ", TAGS.sub(" ", html)).replace("&#39;", "'").replace("&amp;", "&").strip()


def bis_rows(html, where):
    """(item id, item name) for every row a guide ranks BiS, in page order."""
    start = BIS_HEADING.search(html)
    if not start:
        raise ValueError(f"{where}: no 'Best In Slot ... Phase 3' heading - page layout changed?")

    out, ranks = [], set()
    for row in ROW.findall(html[start.end():]):
        cells = CELL.findall(row)
        if len(cells) < 2:
            continue
        link = ITEM_LINK.search(cells[1])
        if not link:
            continue
        rank = text(cells[0])
        ranks.add(rank)
        if RANKED_BIS.search(rank) and not NOT_BIS.search(rank):
            out.append((int(link.group(1)), text(link.group(2))))

    if not out:
        raise ValueError(f"{where}: no rows ranked BiS - ranks seen: {sorted(ranks)[:8]}")
    return out


def preset_ids(source, phase):
    """Item ids in a spec's wowsims preset for one phase, across its dirs.

    Preset names look like 'P4 Arcane Preset' or plain 'P4 Preset'. `match` picks
    the spec's own preset out of a file that holds several; without it every P4
    preset in the file counts, which is right when the file is one spec.
    """
    if not source:
        return set()

    ids = set()
    for directory in source["dirs"]:
        ts = PRESET_CACHE.setdefault(directory, get(WOWSIMS.format(directory)))
        for block in re.split(r"name:\s*'", ts)[1:]:
            name, _, body = block.partition("'")
            if not name.upper().startswith(phase.upper()):
                continue
            if source.get("match") and source["match"].lower() not in name.lower():
                continue
            # stop at the next preset so ids don't bleed across gear sets
            body = re.split(r"name:\s*'", body)[0]
            ids.update(int(m) for m in re.findall(r"\"id\":\s*(\d+)", body))
    return ids


PRESET_CACHE = {}
GUIDE_CACHE = {}


def main():
    write = "--write" in sys.argv
    verbose = "--verbose" in sys.argv
    only = []
    if "--only" in sys.argv:
        only = [a for a in sys.argv[sys.argv.index("--only") + 1:] if not a.startswith("--")]

    loot = json.loads(LOOT.read_text(encoding="utf-8"))
    by_id = {r["id"]: r for r in loot}
    reg = json.loads(SPECS.read_text(encoding="utf-8"))["specs"]
    sources = json.loads(SOURCES.read_text(encoding="utf-8"))["specs"]
    current = json.loads(BIS.read_text(encoding="utf-8"))

    unknown = [s for s in sources if s not in reg]
    if unknown:
        print(f"ERROR: bis-sources.json names specs that are not in specs.json: {unknown}")
        return 1

    built, dropped, mismatches, failures = {}, [], [], []
    no_longevity = []

    for spec in sources:
        if only and spec not in only:
            continue
        source = sources[spec]

        rows = []
        try:
            for url in source["p3"]:
                html = GUIDE_CACHE.setdefault(url, get(url))
                rows += bis_rows(html, spec)
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            failures.append(f"{spec}: {e}")
            continue

        try:
            p4 = preset_ids(source.get("wowsims"), "P4")
            p5 = preset_ids(source.get("wowsims"), "P5")
        except (urllib.error.URLError, TimeoutError) as e:
            failures.append(f"{spec} wowsims: {e}")
            continue
        if not source.get("wowsims"):
            no_longevity.append(spec)

        entries, seen = [], set()
        for item_id, name in rows:
            if item_id in seen:
                continue
            seen.add(item_id)

            rec = by_id.get(item_id)
            if not rec:
                dropped.append((spec, item_id, name))
                continue
            if name and rec["item"] != name:
                mismatches.append(f"{spec}: id {item_id} is {rec['item']!r} here, {name!r} on Wowhead")

            tier = 3 if item_id in p5 else 2 if item_id in p4 else 1
            entry = {"id": item_id, "item": rec["item"]}
            if tier > 1:
                entry["bis"] = TIERS[tier]
            entries.append(entry)

        if entries:
            built[spec] = {"P3": sorted(entries, key=lambda e: e["item"])}
        print(f"  {spec:<13} {len(entries):>2} kept, {len([d for d in dropped if d[0] == spec]):>2} not in this dataset")
        if verbose:
            for e in sorted(entries, key=lambda e: e["item"]):
                print(f"      {e.get('bis', 'phase'):<10} {e['item']}")

    if failures:
        print(f"\nFAILED ({len(failures)}) - nothing written:")
        for f in failures:
            print(f"  {f}")
        return 1

    # --- what changes against the file as it stands -------------------------
    conflicts, additions, uncorroborated = [], 0, []
    merged = json.loads(json.dumps(current))   # deep copy; keeps note + key order

    for spec, phases in built.items():
        have = {e["id"]: e for e in current.get("specs", {}).get(spec, {}).get("P3", [])}
        keep = []
        for entry in phases["P3"]:
            old = have.get(entry["id"])
            if old:
                # an existing hand-set tier is left exactly as it is; a disagreement
                # is reported for a human to rule on rather than overwritten. Specs
                # with no wowsims preset can't disagree - their tier is the default,
                # not a derivation, so comparing it would invent a conflict.
                derived = sources[spec].get("wowsims")
                if derived and old.get("bis", "phase") != entry.get("bis", "phase"):
                    conflicts.append(
                        f"{spec} / {entry['item']}: file says {old.get('bis', 'phase')}, "
                        f"wowsims presets say {entry.get('bis', 'phase')}"
                    )
                keep.append(old)
            else:
                keep.append(entry)
                additions += 1
        for item_id, old in have.items():
            if item_id not in {e["id"] for e in phases["P3"]}:
                uncorroborated.append(f"{spec} / {old['item']} - kept, but not BiS in the Phase 3 guide")
                keep.append(old)
        merged.setdefault("specs", {})[spec] = {"P3": sorted(keep, key=lambda e: e["item"])}

    total = sum(len(p["P3"]) for p in merged.get("specs", {}).values())
    print(f"\n{total} entries across {len(merged.get('specs', {}))} specs ({additions} new)")

    if no_longevity:
        print(f"\nno wowsims preset, so everything stays 'phase' ({len(no_longevity)}): {', '.join(no_longevity)}")
    if dropped:
        print(f"\nBiS on Wowhead but not in this dataset ({len(dropped)}) - dropped, not added:")
        for spec, item_id, name in dropped[:40]:
            print(f"  {spec:<13} {item_id:<7} {name}")
        if len(dropped) > 40:
            print(f"  ... and {len(dropped) - 40} more")
    if mismatches:
        print(f"\nname mismatches ({len(mismatches)}):")
        for m in mismatches:
            print(f"  {m}")
    if uncorroborated:
        print(f"\nalready in bis.json, not in the guide ({len(uncorroborated)}):")
        for u in uncorroborated:
            print(f"  {u}")
    if conflicts:
        print(f"\ntier conflicts ({len(conflicts)}) - file wins, rule on these by hand:")
        for c in conflicts:
            print(f"  {c}")

    if not write:
        print("\nDry run. Re-run with --write to apply.")
        return 0

    BIS.write_text(json.dumps(merged, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nWrote {BIS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
