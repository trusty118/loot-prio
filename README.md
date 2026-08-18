# TBC Tier 6 Loot Priority

A browsable, filterable mirror of the WoW TBC Classic **Tier 6 loot priority guide** covering
Black Temple, Mount Hyjal, and the Heart of Darkness craftables.

**Live site:** https://trusty118.github.io/loot-prio/

## Credit

All loot priorities and item calls are the work of **[zatar_wow](https://twitch.tv/zatar_wow)**, whose
site `tbc.classicwowbuilds.com` has been offline for several years. This repo is a **community
mirror / preservation** of that guide — not original analysis. The data was reconstructed from
their two YouTube videos on Tier 6 loot priority (Mount Hyjal, part 1; Black Temple, part 2).

Hunter bow priorities were credited in-video to **Veramos**; arms-warrior input to **Lemonism**.

Item IDs, slots and armour types come from the [wowsims/tbc](https://github.com/wowsims/tbc) item
database. Tooltips and icons by [Wowhead](https://www.wowhead.com/tbc).

## Structure

```
index.html            markup + Wowhead tooltip script
style.css             styling (dark theme, role colour coding)
app.js                fetch + filter + render (vanilla, no build step)
data/loot_data.json   182 item records — the source of truth
```

No build step, no dependencies. Deployed straight from `main` via GitHub Pages.

## Running locally

`fetch()` needs HTTP, so opening `index.html` from disk will not load the data. Serve the folder:

```bash
python -m http.server 8000
# then open http://localhost:8000
```

## Features

- **Zone → boss** filtering (the primary use case), results grouped in encounter order
- **Class → spec** filtering: narrows to the items whose priority names you, dims everyone
  else in each line, and can narrow again to that spec's best-in-slot items
- Role filter (Physical / Caster / Healer / Tank / Tier), type and slot filters, free-text search
- Live counts on every filter chip, reflecting the other active filters
- Filter state is written to the URL hash, so any view is linkable
- Wowhead tooltips and icons on every item link

## Data

`data/loot_data.json` is a flat array of records:

```json
{
  "zone": "Black Temple",
  "boss": "Illidan Stormrage",
  "item": "Bulwark of Azzinoth",
  "id": 32375,
  "wowhead": "https://www.wowhead.com/tbc/item=32375",
  "slot": "Off-Hand",
  "type": "Shield",
  "role": "Tank",
  "priority": [
    { "spec": "ProtWarr" },
    { "spec": "ProtPal", "op": ">" }
  ],
  "notes": "Warrior never unequips it; pally often swaps shields."
}
```

182 records: Black Temple 109, Mount Hyjal 61, Crafted 12.

`priority` is an ordered list. Each entry names a `spec` or `class` identifier from
`data/specs.json`, plus the operator linking it to the entry before it. Operators are
`>` (better than), `>>` (much better), `~>` (roughly better), `=` (equal) and `~=`
(roughly equal); the first three advance the position, the last two hold it.

Two more data files:

- **`data/specs.json`** - the registry of 9 classes and all 27 TBC specs, with the
  identifier, display name and icon for each. Identifiers are what the other files store,
  so renaming a label never touches data.
- **`data/bis.json`** - which items are best-in-slot for which spec, keyed by the same
  identifiers, and marked `phase`, `multiPhase` or `expansion`.

Run `python3 verify/check_priority.py` and `python3 verify/check_bis.py` after editing
either; both exit non-zero on a bad identifier or operator.

### Known gaps

- **Boss attribution was verified by hand** against Wowhead in Aug 2026 - 27 confirmed,
  24 corrected. `verify/boss-attribution.csv` is the record.
- **Not included:** gems, and the pure shadow-resistance set for Mother Shahraz. Both were
  intentionally omitted as situational rather than loot-council calls.
- **23 items have an empty priority**, meaning "whoever needs it". The creator's wording
  for those ("biggest upgrade", "whoever", "skip") lives in the notes instead, so the
  priority column only ever holds specs and operators.

## Disclaimer

Not affiliated with Blizzard Entertainment. World of Warcraft is a trademark of Blizzard
Entertainment, Inc.
