# TBC Loot Priority Site

A browsable, filterable mirror of a WoW TBC Classic (Tier 6) loot-priority guide,
hosted on GitHub Pages at **https://trusty118.github.io/loot-prio/**.

Vanilla `index.html` + `style.css` + `app.js` reading JSON. **No build step** — that is
deliberate, so Pages can serve the repo root directly. Don't introduce one.

---

## 1. Getting set up on a new machine

```bash
git clone https://github.com/trusty118/loot-prio.git
cd loot-prio
npm install          # jsdom, for the tests only - the site itself has no dependencies
npm test             # 252 checks, should be all green
python3 -m http.server 8642 --bind 127.0.0.1   # then open http://localhost:8642
```

Needs `node` and `python3`. `gh` is optional (only used to poll the Pages build).

**Always view over HTTP**, never by opening `index.html` from disk — the page `fetch`es
its data and will show a load error otherwise.

---

## 2. The data

### `data/loot_data.json` — 182 items, the source of truth

Flat array, grouped in the file by zone then boss in kill order, so a boss's items sit
together for hand-editing.

| Field | Meaning |
|---|---|
| `zone` | `Black Temple`, `Mount Hyjal`, `Crafted (Heart of Darkness)` |
| `boss` | Boss name, `Trash`, or `—` for crafted (rendered as its zone, not as a boss) |
| `item` / `id` / `wowhead` | Name, real TBC item ID, Wowhead link |
| `slot` | `Head` … `Two-Hand`, `Ranged`, `Relic`. Collapsed for display: all weapon slots → `Weapon`, `Ranged`+`Relic` → `Ranged/Relic` |
| `type` | Armour class or weapon type. Displayed with tidy-ups: `2H Staff` → `Staff`, bare `Mace` → `1H Mace` (hand count derived from slot) |
| `role` | Physical / Caster / Healer / Tank / Tier. **Currently hidden** — see `SHOW_ROLE` |
| `priority` | Ordered list of entries, each naming the operator linking it to the previous one — see §3 |
| `notes` | Caveats. All conditional wording lives here, never in `priority` |
| `unique` | `true` only on the 19 unique items. **Absent means not unique** — see Repeats in §3 |

**`priority` is structured data, not prose.** 23 items have an empty list, meaning
"whoever needs it"; the reason is in the notes.

### `data/specs.json` — the class/spec registry

```json
"specs": { "ProtWarr": { "class": "Warrior", "name": "Protection Warrior",
                         "icon": "ability_warrior_defensivestance", "roles": ["Tank"] } }
```

Four sections: `classes` (9), `specs` (all 27 TBC specs), `forms` (Feral bear/cat),
`races` (Orc/Human), and `aliases` (the old priority shorthand → id, used by the migration
and by search only).

**The key (`ProtWarr`) is the identifier every other data file stores; `name` is display
only.** Renaming a label never touches a data file. Adding a spec is a data edit, not a
code edit — check the icon returns 200 first.

### `data/bis.json` — which items are BiS for which spec

```json
"ProtWarr": {
  "P3": [ { "id": 32375, "item": "Bulwark of Azzinoth", "bis": "expansion" } ]
}
```

- Keys are the **identifiers** from `data/specs.json` (`ProtWarr`, not
  `Protection Warrior` and not `Prot Warrior`).
- `bis` is optional, defaults to `phase`. Values: `phase` | `multiPhase` | `expansion`.
- Phase keys (`P3`) exist so P4/P5 can be added later without a migration.
- **Run `python3 verify/check_bis.py` after editing.**

---

## 3. How the priority column renders

`priority` is an ordered list. Each entry names a `spec` or a `class` from
`data/specs.json`, plus the `op` that links it to the entry before it:

```json
"priority": [
  { "spec": "Rogue" },
  { "spec": "EnhShaman", "op": "=" },
  { "spec": "ArmsWarr",  "op": ">>" },
  { "spec": "FuryWarr",  "op": ">", "race": "Orc" }
]
```

The first entry has no `op`; every later one must have one. A `race` renders its own icon
before the spec's. A `form` (`bear`/`cat` on `FeralDruid`) swaps the icon and name.

### Operators

| Op | Means | Position |
|---|---|---|
| `>` | better than | next |
| `>>` | much better than | next |
| `~>` | roughly better than | next |
| `=` | equal | same |
| `~=` | roughly equal | same |

`positions()` folds a list into 1-based ranks: `=` and `~=` hold, the rest advance. `>>`
and `~>` behave exactly like `>` for ranking — they differ only in what they say, which is
what `OPERATORS[op].label` is for (it already feeds the operator tooltips).

### Repeats

A spec may appear twice in one priority only when that person could actually equip two:
the item is in `Finger`, `Trinket`, `One-Hand`, `Main-Hand` or `Off-Hand`, **and** is not
`unique`. Two-handers, armour and ranged slots cannot, and `check_priority.py` rejects
those. Blessed Band of Karabor is the live example - a non-unique ring listing Resto Druid
at two positions.

`unique` comes from Wowhead's tooltip data via `verify/fetch_unique.py`, which also
cross-checks every id against Wowhead's name. That is how two swapped ids were found: the
Forgotten Protector and Vanquisher helms were pointing at each other's items.

**This replaced a regex that scanned the string for known shorthand.** That version failed
silently: a word the table didn't know rendered as plain text with no icon and no error.
`verify/check_priority.py` now makes that an error - it caught 148 broken references the
moment the spec identifiers were renamed. `verify/migrate_priority.py` is the one-shot
conversion, kept as the audit trail.

### BiS rings

`data/bis.json` is keyed by the same identifiers and joined on identifier + item id, then
draws a ring on that spec's icon. Colours follow WoW's item-quality ladder, so "rarer"
reads as "lasts longer":

| Tier | Colour |
|---|---|
| Phase BiS | epic purple `#a335ee` |
| Multi-phase BiS | legendary orange `#ff8000` |
| Expansion BiS | artifact gold `#e6cc80` |

**A ring can only appear on a spec the priority lists.** An item that is BiS for Arcane
Mage, on a row whose priority lists `Mage`, records correctly but shows nothing.
`check_bis.py` reports these as "not visible" — warnings, not errors.

`specs.json` and `bis.json` both **fail soft**: a 404 or malformed file costs the icons or
the rings, not the page.

## 4. Conventions that are easy to break

- **Never use a bare element selector in `style.css`.** Wowhead's tooltip script injects
  its own DOM into the page. A bare `table { min-width: 940px }` once matched their
  tooltip tables and pinned every item tooltip to 940px wide — and `min-width` beats
  `width` and `max-width`, so no override could fix it. Scope to `.boss-group table`.
- **Don't hide table cells with `display: none`.** The tables are `table-layout: fixed`;
  hiding a cell makes the rest shift into the wrong columns. Don't generate the column
  (see `SHOW_ROLE`).
- **`title` attributes have a ~1s browser delay** that can't be configured. Icon tooltips
  use `data-tip` plus a `.tip` element parented to `<body>` (inside the table it would be
  clipped by the scroll container).
- **Icon URLs are verified before use.** Everything comes from `wow.zamimg.com`; check a
  new one returns 200 before wiring it up. Boss portraits are Encounter Journal art
  (`ui-ej-boss-*.png`) with irregular slugs — `najentus`, `kazrogal`, no leading "the" on
  the Illidari Council.
- **`SHOW_ROLE = false`** in `app.js` switches off the Role column and filter. Everything
  behind it still works — chips, filtering, sort key, search index, token class matching.

---

## 5. Tests

`npm test` runs both:

- `test/smoke.mjs` — renders the page in jsdom and asserts filtering, sorting, grouping,
  icons, operators, BiS rings, tooltips and the data edits.
- `test/bis-fallback.mjs` — a missing or malformed `bis.json` degrades gracefully.

They can't cover anything needing a real browser: Wowhead's script doesn't complete its
data fetch under jsdom, so **item icons and item tooltips are untested** — check those by
eye at `localhost:8642`.

Validators, all exiting non-zero on error:

- `python3 verify/check_priority.py` — every identifier resolves, operators are valid and
  present except on the first entry, no duplicate spec in a record.
- `python3 verify/check_bis.py` — keys and ids resolve, `id`/`item` pairs agree, and it
  warns about entries that can never show a ring.

Finished one-shot tools, kept as audit trails: `verify/migrate_priority.py` (string ->
structured priority), `verify/fetch_unique.py` (re-runnable if the item set changes), and
`verify/apply.py` (boss attribution).

---

## 6. Known gaps

- **`verify/missing-items.md`** — 2 items confirmed absent from the dataset. An ID-block
  scan suggests 20-30 more; cross-referencing the
  [wowsims/tbc](https://github.com/wowsims/tbc) item DB would settle it.
- **Not included at all:** gems, and Mother Shahraz's shadow-resistance set. Both were
  intentional omissions by the creator.
- **Duplicate "Trash" chip** when no zone is selected — boss names aren't unique across
  zones, so either chip selects both.
- Planned but not built: a **spec/class filter** reading `bis.json` (`BIS_BY_SPEC` in
  `app.js` is already shaped for it), and clicking a class icon to show that class's BiS.

---

## 7. Attribution (required, keep it prominent)

The priorities are the work of **[zatar_wow](https://twitch.tv/zatar_wow)**, whose site
`tbc.classicwowbuilds.com` has been offline for years. This is a community mirror, not
original analysis. Reconstructed from their two videos:
[Mount Hyjal](https://www.youtube.com/watch?v=B3zgswtk6T8) and
[Black Temple](https://www.youtube.com/watch?v=6SWlWDYTkvU). Hunter bow priorities were
credited in-video to **Veramos**, arms-warrior input to **Lemonism**.

Item IDs and slots came from [wowsims/tbc](https://github.com/wowsims/tbc). Icons and
tooltips from [Wowhead](https://www.wowhead.com/tbc).

Boss attribution for 52 Black Temple items was verified by hand against Wowhead in
Aug 2026 — 27 confirmed, 24 corrected. `verify/boss-attribution.csv` is the record.
