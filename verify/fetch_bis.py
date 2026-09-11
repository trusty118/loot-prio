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
    # "Best without Madness/Stormrage", "Best until Unforgivable Sin" - best, but only
    # while you lack some other item. A condition, and it has to carry a NAME or the row
    # cannot get a slot group of its own: without one it joined the plain "Best" group,
    # overflowed the slot, and the capacity rule marked it near - so four rows rendered as
    # alternatives when the author had called them best. The word itself is suppressed on
    # screen (SILENT_VARIANTS in app.js), because "Phase BiS - Unless" tells a reader
    # nothing; the condition names another item, which is freeform prose we do not parse.
    (re.compile(r"\bwith(out)?\b|\buntil\b(?!\s+tier)", re.I), "unless"),
    # two of the same item, or one judged on its own rather than as part of a set
    (re.compile(r"\bpair\b|\bx2\b", re.I), "pair"),
    (re.compile(r"\bindividually\b", re.I), "individually"),
    (re.compile(r"\boverall\b", re.I), "overall"),
]

# "BiS" said in more words. These are not qualifiers, and swallowing them is what keeps
# 50-odd entries from carrying a meaningless one. Checked AFTER the variants, so
# "Best in slot (2.6 MH)" still resolves as mainhand rather than being flattened here.
# Where the item COMES FROM is not a gear-set qualifier. "Best (Contested)" and "Best
# (World Boss)" say how you get the thing, not which build wants it, so they are plain BiS
# and must not split a slot group - two cloaks in one slot are two cloaks however they drop.
SOURCE_NOTE = r"contested|world ?boss|crafted|bop|boe|quest|reputation|rep|pvp vendor"

PLAIN_RANK = re.compile(
    r"^(bis|best|best in slot|best pve|best personal|best all game|"
    r"p[12345](\s+\w+)?\s*bis|bis\s*\(small upgrade\)|"
    r"best(\s+in\s+slot)?\s*\(all\)|"
    r"(best|bis)(\s+in\s+slot)?\s*[-\u2013(]*\s*(" + SOURCE_NOTE + r")\s*\)?)$", re.I)


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

# Authors differ, and the line between them is whether the rank CLAIMS the item is best or
# merely OFFERS it. "Best without Madness/Stormrage" is a claim with a condition on it;
# "Hit Alternative" is an offer. 77% of the 627 distinct rank strings are used by exactly
# one spec, so no single wording rule can be right everywhere - but this distinction turns
# out to hold across guides that agree on nothing else.
#
# An offer that names a REASON becomes an alternate: blue, no claim on longevity or on what
# the slot can hold. An offer that names none - bare "Option", "Great", "Good", "Viable" -
# stays invisible, because a ring on it would say only "somebody listed it". Measured: with
# a reason, 292 entries and +28 icons on the Phase 3 meta view; without, 2,961 and +167,
# which roughly doubles it.
OFFERED = re.compile(r"\balternat|\boption", re.I)
NAMES_A_REASON = re.compile(
    r"\bhit\b|\bhaste\b|\bcrit\b|\bthreat\b|\bmit(igation)?\b|\bregen\b|"
    r"\bthroughput\b|\bdagger\b|\bshield\b|\bMH\b|\bOH\b|\b[369]%|"
    r"spell ?power|expertise|skewed|without|until", re.I)


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

# How many of a slot one person wears at once. A guide listing three "Best" two-handers
# is ranking them - the first is BiS and the rest are near-BiS alternatives - but two
# "Best" rings really are two rings.
SLOT_CAPACITY = {"Finger": 2, "Trinket": 2, "One-Hand": 2}


def capacity(slot):
    return SLOT_CAPACITY.get(slot, 1)


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


def scan_rows(html, where, phase):
    """Every item row the guide's BiS table holds, in page order, with a verdict.

    Returns dicts: row (index in the table), id, item, rank (the cell VERBATIM), kept,
    and when kept is False, why.

    This used to be bis_rows(), which filtered as it read and returned only the survivors -
    so what the tool DISCARDED was unobservable, and the raw rank text vanished the moment
    variant_for() had mapped it. That is how a "mitigation" qualifier on a Beast Mastery
    hunter went unnoticed: nothing kept the string it came from. Keeping every row here,
    and filtering at the call site, is what lets verify/dump_bis_raw.py audit the real
    parser rather than a second copy of it that could be wrong in different ways.

    Page order is preserved and reported, because Wowhead ranks by row position - that is
    the whole basis of the near-BiS marking downstream.
    """
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
        why = None
        if not RANKED_BIS.search(rank):
            why = "rank does not lead with Best or name BiS"
        elif not_bis.search(rank):
            why = "rank is qualified into something other than BiS"
        # Not a BiS claim, but the author did offer it AND said what for. That is an
        # alternate - shown, in blue, making no claim on longevity or slot capacity.
        alternate = why is not None and bool(
            OFFERED.search(rank) and NAMES_A_REASON.search(rank))
        out.append({
            "row": len(out),
            "id": int(link.group(1)),
            "item": text(link.group(2)),
            "rank": rank,
            "kept": why is None,
            "why": why,
            "alternate": alternate,
        })

    if not any(r["kept"] for r in out):
        raise ValueError(f"{where}: no rows ranked BiS - ranks seen: {sorted(ranks)[:8]}")
    return out


def bis_rows(html, where, phase):
    """(item id, item name, rank) for the rows that ARE BiS, in page order.

    The shape fetch_bis.py has always consumed. scan_rows() is the parser now; this is the
    filter over it, kept separate so the dump can see what this throws away.
    """
    return [(r["id"], r["item"], r["rank"], r["alternate"])
            for r in scan_rows(html, where, phase) if r["kept"] or r["alternate"]]


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
    near_marked = []
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

        # WHICH ROWS ARE ACTUALLY BiS, decided before anything is counted. A guide lists
        # several rows as "Best" in one slot and ranks them by row order, so everything
        # past what the slot holds is a near-BiS alternative. It has to be settled first:
        # a near-BiS row must not count toward how long an item lasted, or a third-choice
        # sword in P4 would look like the item surviving P4.
        near_ids = {}
        for ph, rows in per_phase.items():
            filled, near_ids[ph] = {}, set()
            for item_id, name, rank, alternate in rows:
                rec = by_id.get(item_id)
                if not rec:
                    continue
                # An offered alternate is blue already and never claimed the slot, so it
                # must not consume capacity - otherwise a row the author merely suggested
                # would push a row the author called best into being an alternative.
                if alternate:
                    near_ids[ph].add(item_id)
                    continue
                variant, _ = variant_for(rank)
                key = (rec["slot"], variant or "")
                filled[key] = filled.get(key, 0) + 1
                if filled[key] > capacity(rec["slot"]):
                    near_ids[ph].add(item_id)
                    near_marked.append(
                        f"{spec} {ph} {rec['slot']}: {rec['item']} "
                        f"(#{filled[key]} listed best)")

        # "Best until Unforgivable Sin" names the item that REPLACES this one, so that
        # phase is the author telling you the run ends - the opposite of what `expansion`
        # claims. It is still BiS in that phase and still draws its ring; it just cannot
        # be the evidence that anything lasted. "Best WITHOUT X" is untouched: that is a
        # condition on your gear, not an expiry date.
        #
        # "until tier" is excluded because NOT_BIS_ALWAYS already rejects those outright.
        capped = {ph: {r[0] for r in rows
                       if re.search(r"\buntil\b(?!\s+tier)", r[2], re.I)}
                  for ph, rows in per_phase.items()}

        listed = {ph: {r[0] for r in rows
                       if r[0] not in near_ids[ph] and r[0] not in capped[ph]}
                  for ph, rows in per_phase.items()}

        # --- how long it lasts: ONE answer per item, shown in every phase it appears ---
        #
        # This was computed per phase until Sep 2026 - "if you pick it up in P3, how long
        # does it serve?" - which read as an item decaying down the ladder: gold in P3,
        # gold in P4, purple in P5. It could not do anything else, because from the last
        # phase an item has nothing left to outlive. But the colour is read as a property
        # of the ITEM ("gold means this lasts the expansion"), so a ring that changed
        # colour by the phase you happened to be looking at was answering a question
        # nobody was asking.
        #
        # `expansion` still means the source's LAST phase names it - you get it before
        # Sunwell and nothing in Sunwell replaces it - rather than any particular run
        # length. An item BiS in P1-P3 and then dropped is not an expansion item; one
        # picked up in P4 and still best in Sunwell is. A single-phase item is `phase`
        # however late that phase falls.
        #
        # This must stay in step with longevityOf() in app.js, which derives the same
        # thing at render time. The client is what draws the rings; this field is the
        # record, and check_bis.py reports when the two disagree.
        last = PHASES[-1]

        def tier_from(item_id):
            where = [ph for ph in PHASES if item_id in listed[ph]]
            if len(where) < 2:
                return 1
            return 3 if item_id in listed[last] else 2

        # --- and whether the claim rests on a CONDITION, which is the other axis ---
        #
        # Wowhead ranks plenty of rows "best" only under a condition - "Best - Hit",
        # "Regen BiS", "BiS - Dagger". Those are real BiS calls, not alternatives, so they
        # keep their tier; but a reader has to be able to tell them from an outright pick,
        # or an item that is only ever the hit-rating choice looks like the flat answer.
        # Halberd of Desolation is the worked example: "Best - Hit" in every hunter phase,
        # shown as solid gold, which read as "this is THE hunter polearm for the expansion".
        #
        # Per ITEM, not per phase, and deliberately: a claim that leans on a condition
        # anywhere leans on it, so one plain listing among four qualified ones does not
        # earn a solid ring. Survival's Halberd is exactly that - plain "Best" in P4 only -
        # and this is what keeps all three hunter specs reading the same.
        #
        # NOT conditional: wordings that emphasise rather than qualify, and a tank's
        # threat/mitigation sets, which are two genuine kits rather than a caveat.
        #
        # "individually" was in here and has been moved OUT, Sep 2026. It reads like
        # emphasis and is not: "BiS Individually" means best when the item is judged on
        # its own, WITHOUT the set bonus it would otherwise be part of - which is exactly
        # a condition, and the same shape as "Best - Hit". 21 entries.
        #
        # "pair" stays, and only because of what it happens to cover: in this data it is
        # the Warglaives of Azzinoth and nothing else, where "Best Pair" describes what
        # you equip rather than when it applies.
        EMPHASIS = {"overall", "pair"}
        SET_VARIANTS = {"threat", "mitigation"}
        is_tank = "Tank" in reg.get(spec, {}).get("roles", [])

        def conditional(variant):
            if not variant or variant in EMPHASIS:
                return False
            return not (is_tank and variant in SET_VARIANTS)

        cond_items = set()
        for ph in PHASES:
            for item_id, _, rank, _alt in per_phase[ph]:
                if item_id in near_ids[ph]:
                    continue
                variant, _ = variant_for(rank)
                if conditional(variant):
                    cond_items.add(item_id)

        phases_out = {}
        for phase in PHASES:
            entries, seen = [], set()
            for item_id, name, rank, _alt in per_phase[phase]:
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
                if item_id in near_ids[phase]:
                    entry["near"] = True
                # The author named this item's replacement in this phase, so the listing
                # is still BiS and still rings - it just cannot be evidence that anything
                # LASTED. Stored rather than left implicit, because the rule has to stay
                # reproducible from the file alone: test/smoke.mjs derives it a third time
                # and has no access to the rank text.
                if item_id in capped[phase]:
                    entry["superseded"] = True
                tier = tier_from(item_id)
                if tier > 1:
                    entry["bis"] = TIERS[tier]
                variant, miss = variant_for(rank)
                if variant:
                    entry["variant"] = variant
                # Per item, so every phase of a conditional pick agrees. Absent means
                # unconditional, the way `near` and `unique` mark only the exception.
                #
                # Never on a near row. Blue already says "an alternative", the two axes do
                # not compose for it, and app.js strips the flag when it indexes - so
                # writing it here would leave 41 entries asserting something the renderer
                # overrides, which is exactly the kind of disagreement bis.json should not
                # contain for anyone reading it or auditing it.
                if item_id in cond_items and not entry.get("near"):
                    entry["conditional"] = True
                if miss:
                    unmapped.setdefault(miss, []).append(f"{spec} {phase}")
                entries.append(entry)
            # Entries stay in GUIDE ORDER. Sorting by name here is what used to throw
            # the ranking away, so three "Best" two-handers all ringed identically.
            if entries:
                phases_out[phase] = entries

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
    if near_marked:
        print(f"\nmarked near-BiS ({len(near_marked)}) - listed 'Best' but past what the "
              f"slot holds, so the guide's own row order says they are alternatives:")
        for n in near_marked[:20]:
            print(f"  {n}")
        if len(near_marked) > 20:
            print(f"  ... and {len(near_marked) - 20} more")
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
