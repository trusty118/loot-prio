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

import hashlib
import functools
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
SPECS = ROOT / "data" / "specs.json"
BIS = ROOT / "data" / "bis.json"
SOURCES = Path(__file__).resolve().parent / "bis-sources.json"
CHANGES = Path(__file__).resolve().parent / "bis-longevity-changes.csv"

WOWSIMS = "https://raw.githubusercontent.com/wowsims/tbc/master/ui/{}/presets.ts"
UA = {"User-Agent": "loot-prio/1.0"}

# the guide's gear tables start under this heading, whichever phase it is for
BIS_HEADING = re.compile(r"Best In Slot Gear.{0,90}?Phase\s*([12345])", re.I | re.S)

# One Wowhead guide per spec per phase. P4 and P5 are derived from the P3 url - the
# slugs differ by a single segment - but P1 and P2 cannot be, so they are listed in
# bis-sources.json instead. Wowhead writes three different url families here: P3/P4/P5
# share one, P1 swaps the tail of it, and P2 lives under /guide/classes/ entirely.
# Phase 2 is also the one phase written PER SPEC where Phase 3 is per class, so five
# specs have a better source at P2 than they do at P3.
PHASE_SLUG = {"P3": "-bt-hyjal-phase-3-", "P4": "-za-phase-4-", "P5": "-swp-phase-5-"}
PHASES = ["P1", "P2", "P3", "P4", "P5"]

# The rank column says WHY an item is BiS, and until now that was read and thrown away.
# Wowhead's wording is not fixed - the same idea arrives as "Best Mitigation", "Best Mit
# Skewed" and "Mitigation + Hit" - so it is mapped onto a closed vocabulary rather than
# shown raw. Anything unmapped keeps its entry, carries no variant, and is REPORTED: the
# set grows when we decide it does, never because a guide invented a phrase.
VARIANT_MAP = [
    # what the item is for
    (re.compile(r"\bthreat\b|\bTPS\b", re.I), "threat"),
    (re.compile(r"\bmit(igation)?\b|\bsurvivability\b|\bdefensive\b|\bdefense swap\b", re.I), "mitigation"),
    (re.compile(r"\bregen\b|\binnervate\b", re.I), "regen"),
    (re.compile(r"\bthroughput\b", re.I), "throughput"),
    (re.compile(r"\bbalanced?\b", re.I), "balanced"),
    # which stat it is chased for. The hit ranks arrive as cap percentages rather than
    # the word - "Best 6% and 9%" is the spell hit cap with and without talents.
    (re.compile(r"\bhaste\b", re.I), "haste"),
    (re.compile(r"\bhit\b|\b[369]%", re.I), "hit"),
    (re.compile(r"\bcrit\b", re.I), "crit"),
    (re.compile(r"\bspell ?power\b", re.I), "spellpower"),
    (re.compile(r"\bexpertise\b", re.I), "expertise"),
    # which weapon the build uses, and which hand it goes in
    (re.compile(r"\bdagger\b", re.I), "dagger"),
    (re.compile(r"\bshield\b", re.I), "shield"),
    (re.compile(r"\bMH\b|\bmain ?hand\b", re.I), "mainhand"),
    (re.compile(r"\bOH\b|\boff ?hand\b", re.I), "offhand"),
    # a race that changes the answer - the case that prompted all of this, and it turns
    # out Wowhead does say it: "2nd bis for humans", "2nd bis for non-humans"
    (re.compile(r"\bnon-?humans?\b", re.I), "non-human"),
    (re.compile(r"\bhumans?\b", re.I), "human"),
    # two of the same item, or one judged on its own rather than as part of a set
    (re.compile(r"\bpair\b|\bx2\b", re.I), "pair"),
    (re.compile(r"\bindividually\b", re.I), "individually"),
    (re.compile(r"\boverall\b", re.I), "overall"),
]

# "BiS" said in more words. These are not qualifiers, and swallowing them is what keeps
# 50-odd entries from carrying a meaningless one. Checked AFTER the variants, so
# "Best in slot (2.6 MH)" still resolves as mainhand rather than being flattened here.
PLAIN_RANK = re.compile(
    r"^(bis|best|best in slot|best pve|best personal|best all game|"
    r"p[12345](\s+\w+)?\s*bis|bis\s*\(small upgrade\)|"
    r"best(\s+in\s+slot)?\s*\(all\))$", re.I)


def variant_for(rank):
    """(variant or None, unmapped rank or None) for one rank cell.

    Variants are tested before the plain list on purpose: several ranks are "best in
    slot" plus a qualifier in brackets, and testing plain first would throw the
    qualifier away.
    """
    rank = (rank or "").strip()
    if not rank:
        return None, None
    for pattern, name in VARIANT_MAP:
        if pattern.search(rank):
            return name, None
    if PLAIN_RANK.match(rank):
        return None, None
    return None, rank

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

# Rejections that hold whatever phase is being read.
NOT_BIS_ALWAYS = r"alternative|option|pre-?raid|pvp|seasonal|until tier|second"


@functools.lru_cache(maxsize=None)
def not_bis_for(phase):
    """Ranks that are not THIS phase's answer.

    This used to be one constant that rejected any row naming phase 2 - correct inside a
    P3 guide, where "P2 BiS" is last tier's answer, and catastrophic inside a P2 one,
    where it rejects every row on the page. What is meant is "some OTHER phase's
    answer", so the phase in hand has to decide which digits those are.
    """
    others = "".join(d for d in "12345" if d != phase[1])
    return re.compile(rf"{NOT_BIS_ALWAYS}|phase\s*[{others}]\b|^p[{others}]\b", re.I)

TIERS = {1: "phase", 2: "multiPhase", 3: "expansion"}


# 84 guide pages per run, and the mapping table takes several passes to get right.
# Without a cache on disk that is 84 requests per pass, which is how this earned a
# string of 403s - so every fetch is kept, and a re-run costs Wowhead nothing. Delete
# the directory to force a refresh.
CACHE_DIR = Path(tempfile.gettempdir()) / "loot-prio-bis-cache"


def get(url, as_json=False):
    CACHE_DIR.mkdir(parents=True, exist_ok=True)
    hit = CACHE_DIR / (hashlib.sha1(url.encode()).hexdigest() + ".txt")
    if hit.exists():
        raw = hit.read_text(encoding="utf-8")
    else:
        req = urllib.request.Request(url, headers=UA)
        with urllib.request.urlopen(req, timeout=30) as r:
            raw = r.read().decode("utf-8", "replace")
        hit.write_text(raw, encoding="utf-8")
        time.sleep(1.0)   # be polite: one page a second when actually fetching
    return json.loads(raw) if as_json else raw


def text(html):
    return re.sub(r"\s+", " ", TAGS.sub(" ", html)).replace("&#39;", "'").replace("&amp;", "&").strip()


def bis_rows(html, where, phase):
    """(item id, item name, rank) for every row a guide ranks BiS, in page order."""
    not_bis = not_bis_for(phase)
    start = BIS_HEADING.search(html)
    if not start:
        raise ValueError(f"{where}: no 'Best In Slot ... Phase N' heading - page layout changed?")

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
        if RANKED_BIS.search(rank) and not not_bis.search(rank):
            out.append((int(link.group(1)), text(link.group(2)), rank))

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

    built, sim_presets = {}, {}
    dropped, mismatches, failures, unmapped = [], [], [], {}
    sim_disagrees, longevity_changes = [], []

    for spec in sources:
        if only and spec not in only:
            continue
        source = sources[spec]

        # --- every phase's guide, so longevity can be observed rather than guessed ---
        per_phase = {}
        try:
            for phase in PHASES:
                urls = source.get(phase.lower())
                if not urls:
                    urls = [u.replace(PHASE_SLUG["P3"], PHASE_SLUG[phase]) for u in source["p3"]]
                rows = []
                for url in urls:
                    rows += bis_rows(GUIDE_CACHE.setdefault(url, get(url)),
                                     f"{spec} {phase}", phase)
                per_phase[phase] = rows
        except (urllib.error.URLError, TimeoutError, ValueError) as e:
            failures.append(f"{spec}: {e}")
            continue

        listed = {ph: {r[0] for r in rows} for ph, rows in per_phase.items()}

        # --- how long it lasts, counted forward from the phase in hand ---
        # Wowhead covers every spec; wowsims has no preset for the eight that are not
        # meta, so it cannot decide this for anyone - its silence would read as "one
        # phase" rather than as "unknown". It cross-checks instead, below.
        def tier_from(phase, item_id):
            run = 0
            for ph in PHASES[PHASES.index(phase):]:
                if item_id in listed[ph]:
                    run += 1
                else:
                    break
            return min(max(run, 1), 3)

        phases_out = {}
        for phase in PHASES:
            entries, seen = [], set()
            for item_id, name, rank in per_phase[phase]:
                if item_id in seen:
                    continue
                seen.add(item_id)
                rec = by_id.get(item_id)
                if not rec:
                    dropped.append((spec, phase, item_id, name))
                    continue
                if name and rec["item"] != name:
                    mismatches.append(
                        f"{spec}: id {item_id} is {rec['item']!r} here, {name!r} on Wowhead")

                entry = {"id": item_id, "item": rec["item"]}
                tier = tier_from(phase, item_id)
                if tier > 1:
                    entry["bis"] = TIERS[tier]
                variant, miss = variant_for(rank)
                if variant:
                    entry["variant"] = variant
                if miss:
                    unmapped.setdefault(miss, []).append(f"{spec} {phase}")
                entries.append(entry)
            if entries:
                phases_out[phase] = sorted(entries, key=lambda e: (e["item"], e.get("variant", "")))

        if phases_out:
            built[spec] = phases_out

        # --- wowsims: kept, and used as a cross-check ---
        # Wowhead decides what renders, because it is the only source covering all 28
        # specs. wowsims is stored beside it rather than thrown away: the plan is to let
        # people choose their BiS data source, and that needs the other source's answer
        # to still exist. Nothing reads it yet.
        if source.get("wowsims"):
            try:
                sim = {2: preset_ids(source["wowsims"], "P4"), 3: preset_ids(source["wowsims"], "P5")}
            except (urllib.error.URLError, TimeoutError) as e:
                failures.append(f"{spec} wowsims: {e}")
                sim = None
            if sim:
                sim_presets[spec] = {"P4": sorted(sim[2]), "P5": sorted(sim[3])}
                for entry in phases_out.get("P3", []):
                    ours = {"phase": 1, "multiPhase": 2, "expansion": 3}[entry.get("bis", "phase")]
                    theirs = 3 if entry["id"] in sim[3] else 2 if entry["id"] in sim[2] else 1
                    if ours != theirs:
                        sim_disagrees.append(
                            f"{spec} / {entry['item']}: guides say {TIERS[ours]}, "
                            f"wowsims presets say {TIERS[theirs]}")

        # --- what moves against the file as it stands ---
        was = {e["id"]: e.get("bis", "phase")
               for e in current.get("specs", {}).get(spec, {}).get("P3", [])}
        for entry in phases_out.get("P3", []):
            old = was.get(entry["id"])
            now = entry.get("bis", "phase")
            if old and old != now:
                longevity_changes.append(f"{spec} / {entry['item']}: {old} -> {now}")

        counts = " ".join(f"{ph}:{len(phases_out.get(ph, []))}" for ph in PHASES)
        print(f"  {spec:<13} {counts}")
        if verbose:
            for ph in PHASES:
                for e in phases_out.get(ph, []):
                    q = f" ({e['variant']})" if e.get("variant") else ""
                    print(f"      {ph} {e.get('bis', 'phase'):<10} {e['item']}{q}")

    if failures:
        print(f"\nFAILED ({len(failures)}) - nothing written:")
        for f in failures:
            print(f"  {f}")
        return 1

    merged = json.loads(json.dumps(current))
    merged.setdefault("specs", {})
    for spec, phases_out in built.items():
        merged["specs"][spec] = phases_out
    if sim_presets:
        # A sibling key, not a field on each entry: choosing a data source swaps the
        # whole list, so the two answers sit side by side rather than interleaved.
        merged["wowsimsPresets"] = dict(sorted(sim_presets.items()))

    total = sum(len(v) for sp in merged["specs"].values() for v in sp.values())
    variants = sum(1 for sp in merged["specs"].values() for v in sp.values()
                   for e in v if e.get("variant"))
    print(f"\n{total} entries across {len(merged['specs'])} specs, {variants} carrying a variant")

    if unmapped:
        print(f"\nrank wordings with no variant ({len(unmapped)}) - entry kept, qualifier left off:")
        for rank, where in sorted(unmapped.items(), key=lambda kv: -len(kv[1])):
            print(f"  {len(where):>3}x  {rank}")
    if longevity_changes:
        print(f"\nP3 longevity that moves, now it is derived from the guides "
              f"({len(longevity_changes)}) - written to {CHANGES.name}")
        CHANGES.write_text(
            "spec,item,was,now\n" + "\n".join(
                c.replace(" / ", ",").replace(": ", ",").replace(" -> ", ",")
                for c in longevity_changes) + "\n", encoding="utf-8")
    if sim_disagrees:
        print(f"\nwowsims disagrees with the guides ({len(sim_disagrees)}) - guides win, "
              f"listed so the gap is visible:")
        for d in sim_disagrees[:20]:
            print(f"  {d}")
        if len(sim_disagrees) > 20:
            print(f"  ... and {len(sim_disagrees) - 20} more")
    if dropped:
        print(f"\nBiS on Wowhead but not in this dataset ({len(dropped)}) - dropped, not added")
    if mismatches:
        print(f"\nname mismatches ({len(mismatches)}):")
        for m in mismatches:
            print(f"  {m}")

    if not write:
        print("\nDry run. Re-run with --write to apply.")
        return 0

    BIS.write_text(json.dumps(merged, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"\nWrote {BIS.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
