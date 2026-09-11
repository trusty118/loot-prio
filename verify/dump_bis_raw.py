#!/usr/bin/env python3
"""Dump every row of every Wowhead BiS guide, raw, so the extraction can be audited.

WHY THIS EXISTS. A hunter ring on Halberd of Desolation claimed expansion BiS. It was
wrong, and tracing it took an hour of reading code because the evidence had been thrown
away: fetch_bis.py reads the rank cell, maps it through VARIANT_MAP onto a closed
vocabulary, and discards the original string. Only the mapped `variant` reaches bis.json.
So "mitigation on a Beast Mastery hunter" could not be told apart from a regex over-match,
and the rows the tool DROPPED were invisible entirely.

This writes what the guides actually say, next to what we decided about it.

IT IMPORTS THE REAL PARSER AND MUST GO ON DOING SO. scan_rows(), variant_for() and
capacity() come from fetch_bis.py, not from a copy here. A dump with its own parsing would
audit code that does not ship, and would be free to be correct where the real one is wrong -
which is the one thing that would make this file worse than useless.

Read-only. Fetches ~130 pages (cached under $TMPDIR by fetch_bis.get) and writes
verify/bis-raw.json. It never touches data/bis.json.
"""
import json
import sys
import urllib.error
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fetch_bis import (  # noqa: E402  - the point of the file is to use these
    BIS, GUIDE_CACHE, LOOT, PHASE_SLUG, PHASES, SOURCES, SPECS,
    capacity, get, scan_rows, variant_for,
)

OUT = Path(__file__).resolve().parent / "bis-raw.json"


def urls_for(source, phase):
    """Exactly fetch_bis.main()'s resolution: an explicit url per phase, else P3 slug-swapped.

    P4 and P5 are DERIVED this way and are not recorded in bis-sources.json, which is worth
    seeing in the dump - it is the least verified part of the pipeline and it is where the
    reported bug lives.
    """
    urls = source.get(phase.lower())
    derived = not urls
    if derived:
        urls = [u.replace(PHASE_SLUG["P3"], PHASE_SLUG[phase]) for u in source["p3"]]
    return urls, derived


def main():
    only = []
    if "--only" in sys.argv:
        only = [a for a in sys.argv[sys.argv.index("--only") + 1:] if not a.startswith("--")]

    by_id = {r["id"]: r for r in json.loads(LOOT.read_text(encoding="utf-8"))}
    sources = json.loads(SOURCES.read_text(encoding="utf-8"))["specs"]
    shipped = json.loads(BIS.read_text(encoding="utf-8"))["specs"]

    out, failures = [], []
    for spec in sources:
        if only and spec not in only:
            continue
        for phase in PHASES:
            try:
                urls, derived = urls_for(sources[spec], phase)
                rows = []
                for url in urls:
                    for r in scan_rows(GUIDE_CACHE.setdefault(url, get(url)),
                                       f"{spec} {phase}", phase):
                        rows.append(dict(r, url=url, derived_url=derived))
            except (urllib.error.URLError, TimeoutError, ValueError) as e:
                failures.append(f"{spec} {phase}: {e}")
                continue

            # Replay the two decisions that happen AFTER parsing, in the same order
            # fetch_bis.main() makes them, so the dump explains the shipped file rather
            # than describing a pipeline nobody runs.
            filled, seen = {}, set()
            for r in rows:
                rec = by_id.get(r["id"])
                variant, unmapped = variant_for(r["rank"])
                r["variant"] = variant
                r["unmapped_rank"] = unmapped        # rank we could not map: kept, no qualifier
                r["slot"] = rec["slot"] if rec else None
                r["in_dataset"] = rec is not None
                r["spec"], r["phase"] = spec, phase

                if not r["kept"]:
                    continue
                # A duplicate id is silently skipped by main(), taking its rank text with
                # it - which is exactly how a second "BiS at 9% hit" row disappears.
                r["duplicate_of_earlier_row"] = r["id"] in seen
                seen.add(r["id"])
                if not rec:
                    continue
                key = (rec["slot"], variant or "")
                filled[key] = filled.get(key, 0) + 1
                r["nth_in_slot_group"] = filled[key]
                r["slot_group"] = f"{rec['slot']}/{variant or '-'}"
                r["near"] = filled[key] > capacity(rec["slot"])

            out += rows

    # What actually shipped, so drift since the last run is visible rather than smoothed.
    for r in out:
        entry = next((e for e in shipped.get(r["spec"], {}).get(r["phase"], [])
                      if e["id"] == r["id"]), None)
        r["shipped"] = None if entry is None else {
            "bis": entry.get("bis", "phase"),
            "near": bool(entry.get("near")),
            "variant": entry.get("variant"),
        }

    OUT.write_text(json.dumps({
        "note": "Raw Wowhead BiS rows with the pipeline's verdict. Generated by "
                "verify/dump_bis_raw.py - see that file for why. Rows are in guide order, "
                "which is how Wowhead ranks them.",
        "rows": out,
    }, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")

    kept = sum(1 for r in out if r["kept"])
    print(f"{len(out)} rows across {len({(r['spec'], r['phase']) for r in out})} spec-phases")
    print(f"  {kept} kept, {len(out) - kept} dropped")
    print(f"  {sum(1 for r in out if r.get('near'))} marked near-BiS")
    print(f"  {sum(1 for r in out if r.get('duplicate_of_earlier_row'))} duplicate ids suppressed")
    print(f"  {sum(1 for r in out if r['unmapped_rank'])} ranks that mapped to no variant")
    print(f"  {sum(1 for r in out if r['kept'] and not r['in_dataset'])} kept rows not in loot_data.json")
    if failures:
        print(f"\nFAILED ({len(failures)}):")
        for f in failures:
            print(f"  {f}")
    print(f"\nWrote {OUT.name}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
