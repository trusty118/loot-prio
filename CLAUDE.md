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
npm test             # 232 checks, should be all green
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
| `priority` | Ordering string, e.g. `SPriest > Warlock = Balance = Elemental > Mage`. `>` ranks, `=` ties |
| `notes` | Caveats. All conditional wording lives here, never in `priority` |

**`priority` contains no prose and no parentheses** — only recognised shorthand and the
`>` `=` operators. Conditions were deliberately moved to `notes`. 23 items have an empty
priority, meaning "whoever needs it"; the reason is in the notes.

### `data/bis.json` — which items are BiS for which spec

```json
"Protection Warrior": {
  "P3": [ { "id": 32375, "item": "Bulwark of Azzinoth", "bis": "expansion" } ]
}
```

- Spec keys must match the **canonical labels** in the `SPECS` table in `app.js`
  (`Restoration Shaman`, not `R Shaman`). Races are not valid keys.
- `bis` is optional, defaults to `phase`. Values: `phase` | `multiPhase` | `expansion`.
- Phase keys (`P3`) exist so P4/P5 can be added later without a migration.
- **Run `python3 verify/check_bis.py` after editing.**

---

## 3. How the priority column renders

This is the least obvious part of the codebase.

`priority` is a **string, scanned with a regex** built from the `SPECS` table
(`SPEC_RE` in `app.js`). Each recognised shorthand is **replaced by its spec icon**; the
operators survive as text. So `SPriest > Warlock` renders as two icons with a `>` between.

**This is fragile and we know it.** A word the table doesn't know renders as plain text
with no icon and no error — adding a priority that says `Balance` when the table only
knows `Boomkin` fails silently. Adding a spec means adding a row to `SPECS` with a
verified icon name.

> **Planned:** replace the string with structure —
> `"priority": [["Shadow Priest"], ["Warlock", "Balance Druid"], ["Mage"]]` — outer array
> ranks, inner array ties. 156 of 182 records convert mechanically; 23 are empty; 3 need
> a decision (`>>`, `>=`, `~`). Daniel has approved this direction; it was deferred so it
> could be done in one sitting on one machine.

### BiS rings

`bis.json` is joined by **canonical spec name + item id** and draws a ring on that spec's
icon. The colours follow WoW's item-quality ladder, so "rarer" reads as "lasts longer":

| Tier | Colour |
|---|---|
| Phase BiS | epic purple `#a335ee` |
| Multi-phase BiS | legendary orange `#ff8000` |
| Expansion BiS | artifact gold `#e6cc80` |

**A ring can only appear on a spec the priority string names.** An item that is BiS for
Arcane Mage, on a row whose priority says `Mage`, records correctly but shows nothing.
`check_bis.py` reports these as "not visible" — they are warnings, not errors.

`bis.json` **fails soft**: a 404 or malformed file costs the rings, not the page.

---

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

- `test/smoke.mjs` — 232 checks. Renders the page in jsdom and asserts filtering, sorting,
  grouping, icons, BiS rings, tooltips and the data edits.
- `test/bis-fallback.mjs` — 7 checks that a missing or malformed `bis.json` degrades
  gracefully.

They can't cover anything needing a real browser: Wowhead's script doesn't complete its
data fetch under jsdom, so **item icons and item tooltips are untested** — check those by
eye at `localhost:8642`.

`verify/check_bis.py` validates `bis.json`. `verify/apply.py` is the (finished) boss
attribution tool, kept as the audit trail.

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
