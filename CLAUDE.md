# TBC Loot Priority Site

A browsable, filterable loot-priority site for WoW TBC Classic, hosted on GitHub Pages at
**https://trusty118.github.io/loot-prio/**. Every raid in the expansion, every item, which
specs each item is best-in-slot for, and priority lists people make and share.

Vanilla `index.html` + `style.css` + `app.js` reading JSON — **no framework and no runtime
dependencies**, and that part is not negotiable. There is a build step (`build.mjs`,
esbuild) but it exists only to decide what is published: it minifies the three files into
`dist/` and copies `data/` beside them. Nothing is transpiled or bundled.

**This file is the map: what is true now, in the present tense.** The reasoning — what was
tried first, what it cost, why it ended up this way — lives in
[`docs/decisions/`](docs/decisions/README.md), one file per area, and each section below
points at its own. Read the decision before changing the thing it covers.

---

## 1. Setup

```bash
git clone https://github.com/trusty118/loot-prio.git && cd loot-prio
npm install          # jsdom for tests, esbuild for the build - the SITE has none
npm test             # six files, ~895 checks, ~30s
npm run serve        # the source, on 8642 - develop against this
npm run build        # dist/, what Pages publishes
npm run serve:dist   # the built artifact, on 8643 - when a bug might be the minifier's
```

Needs `node` and `python3` (`py` on Windows). `gh` is optional, for polling the deploy.
**Always view over HTTP** — the page `fetch`es its data and shows a load error from disk.

---

## 2. The data

### `data/loot_data.json` — 766 items, the source of truth

**Items only; nothing anybody ranked.** Flat array, grouped by zone then boss in kill order.

| Field | Meaning |
|---|---|
| `zone` | One of 12: the nine raids, `World Bosses`, `Crafted (Heart of Darkness)`, `Crafted (Sunmote)` |
| `boss` | Boss name, `Trash`, or `—` for crafted |
| `item` / `id` / `wowhead` | Name, real TBC item id, Wowhead link |
| `slot` | `Head` … `Two-Hand`, `Ranged`, `Relic`. Only the four weapon slots collapse for display (→ `Weapon`). `Ranged` (bows, guns, crossbows, thrown, wands) and `Relic` (idols, totems, librams) are separate |
| `type` | Armour class or weapon type. Caster off-hand frills carry `Off-hand`. Tier tokens carry `Tier Token (War/Priest/Druid)` etc. — six groupings, since T4/T5 group classes differently from T6 |
| `roles` | Non-empty list from Physical / Caster / Healer / Tank / Tier. Drives the editor's smart filtering and search; not rendered. **No cloth item is ever `Physical`** |
| `notes` | **Facts about the item only** — where else it drops, how it is obtained. Opinions live in a list. `test/smoke.mjs` pins the allowed shapes |
| `unique` | `true` on the 127 unique items; absent means not unique |

**Tier armour is not listed; the 54 tokens are.** The guides rank the pieces, so
`verify/tier-tokens.json` maps 290 pieces → their token, and `fetch_bis.py` swaps them
before anything counts a row.

**Sunmote upgrades (22) sit under `Crafted (Sunmote)`, not under the boss.** You roll on the
drop, not the upgrade; each carries a note naming its base item and boss.

**Epic and above only.** Below-epic gear is dropped by `fetch_items.py`; this is also what
keeps the green accent unambiguous (green is uncommon quality; no green item name renders).

Why → [loot-data.md](docs/decisions/loot-data.md)

### `data/rules.json` — the rules three languages agree on

Operators and their labels, slot capacity, the double slots, the armour ladder, relic
classes, tier-token class groupings, the longevity tiers, the **variant vocabulary with its
labels and flags** (`emphasis`, `tankSet`, `uncontested`), and the **phases with their
zones**. `app.js` fetches it at boot (`applyRules()`, not fail-soft: nothing in the priority
column can be drawn without it); `fetch_bis.py`, `check_bis.py`, `check_priority.py`,
`seed_priority.py` and `seed_roles.py` load it; every test file reads it through
`test/helpers.mjs`'s `site.rules`. **Nothing derives any of these at runtime, and nothing
carries a copy.** Adding a variant, a phase or an operator is a line here and nothing else.

### `data/lists/` — the lists that ship with the site

`index.json` names them; each is a template (`validateTemplate()` shape) plus `phase` and
`author`. Today: `zatar-p3.json` — 182 priorities, 177 notes. They are **starting points
somebody opens and copies**, never a fallback: nothing falls back to them, and the picker
offers only those matching the phase on screen. Adding one is a data edit.

**`[]` and no key are different.** An empty priority is somebody answering "whoever needs
it"; a missing key is the list never having mentioned the item. `inTemplate()` draws that line.

Why → [shipped-lists.md](docs/decisions/shipped-lists.md)

### `data/specs.json` — the class/spec registry

`classes` (9), `specs` (28 pickable + the `FeralDruid` umbrella), `forms`, `races`,
`aliases` (47 search shorthands → identifier). **The key (`ProtWarr`) is the identifier every
data file stores; `name` is display only.** Seven specs carry `"meta": false`; absent means
meta. A spec's `roles` are the kinds of loot it gears for, not what it does in a raid
(`ProtPal` carries `Caster`; `FeralCat` carries `Tank`).

Why → [spec-registry.md](docs/decisions/spec-registry.md)

### `data/bis.json` — which items are BiS for which spec

**Generated: `python3 verify/fetch_bis.py --write`.** 2,991 entries, keyed by spec
identifier then phase (`P1`–`P5`), each `{ id, item, bis?, variant?, conditional?, near?,
superseded? }`.

| Field | Meaning |
|---|---|
| `bis` | `phase` (default) / `multiPhase` / `expansion` — **one answer per item per spec**, shown in every phase it appears. Derived: listed in one phase → `phase`; two or more → `multiPhase`; reaches the source's last phase → `expansion` |
| `variant` | A qualifier from the closed vocabulary in `rules.json` (`hit`, `threat`, `2pc`, `non-worldboss`, `below-bis` …), which also says how each reads |
| `conditional` | The guide only ever called it best *under a condition*. **Per item, not per phase.** Draws a dashed ring |
| `near` | Listed past what the slot holds, or offered with a reason but never called best. Draws a blue ring; counts toward nothing |
| `superseded` | The guide named this item's replacement (`Best until X`); rings, but is not evidence of lasting |

Two sources, chosen in the account menu (`lootprio.bisSource`, a preference, **not** in the
url): Wowhead (all 28 specs, every phase — the default) and WoWSims presets (20 specs, P4–P5
only). A source with nothing to say rings nothing and does not fall back.

**The pipeline's inputs are all reviewed JSON, never code:**

| File | What it decides |
|---|---|
| `verify/bis-sources.json` | One Wowhead guide url per spec per phase |
| `verify/rank-map.json` | **Where an author's wording is overruled.** `specs` keys (spec, exact rank string); `items` keys `"Arms/P1/28730"` and beats it. Both accept `bis`, `variant`, `near`. Empty file changes nothing |
| `verify/tier-tokens.json` | piece id → token, identified by (tier, slot, class) |
| `verify/world-boss-drops.json` | Doomwalker and Doom Lord Kazzak's drops |

**Slot capacity** (`rules.json`): 2 for `Finger`, `Trinket`, `One-Hand`; 1 otherwise. Within one (spec,
phase, slot, variant) group, no more entries may claim BiS than that. `below-bis` is
exempt — it states a margin, not a condition under which the row wins.

**Run `python3 verify/check_bis.py` after any edit.** It validates the vocabulary, capacity,
and that the stored `bis` values reproduce from the rule.

Why → [bis-data.md](docs/decisions/bis-data.md)

---

## 3. What the page shows

### The priority column

`priority` is an ordered list of `{ spec | class, op, race?, form? }`. First entry has no
`op`; every later one must.

| Op | Means | Rank |
|---|---|---|
| `>` `>>` `~>` | higher / much higher / roughly higher than | advances |
| `=` `~=` | equal / roughly equal | holds |
| `?` | **not ranked against** — nobody has decided | holds |

**Repeats**: a spec may appear twice only when the item is `Finger`, `Trinket`, `One-Hand`,
`Main-Hand` or `Off-Hand` **and** not `unique`. Enforced by `check_priority.py` and by the
editor (`allowsRepeat()`).

**With no list open, or on a row the open list has no key for, the column shows the BiS
view**: every spec the item is BiS for, joined by `?`, in registry order, no prose. Never
while editing.

Why → [priority-column.md](docs/decisions/priority-column.md)

### BiS rings

Two independent axes on the spec icon. **Colour says how long; ring style says whether
there is a condition.**

| | |
|---|---|
| Phase BiS | epic purple `#a335ee` |
| Multi-phase BiS | legendary orange `#ff8000` |
| Expansion BiS | artifact gold `#e6cc80` |
| Alternate (`near`) | rare blue `#0070dd` — ranks *below* purple |
| `conditional` | **dashed** (`outline`, since `<img>` has no `::after`), colour unchanged |

A class icon takes the highest tier among its specs (`bisRank()` puts blue under purple;
`bisPick()` keeps blue out of seeding and filters). Who the ring is for goes on the
tooltip's name line. **Never add specs to a list's `priority` to make a ring visible** —
that rewrites the author.

Why → [bis-rings.md](docs/decisions/bis-rings.md)

### Phase → zone → boss

**The phase is a mode, not a filter**: one is always selected, there is no `All`, and
`defaultPhase()` is the last phase with items. Zone and boss below it are filters; leaving
one unset means all of it. Picking a phase clears the zone and boss under it.

```
P1  Karazhan · Gruul's Lair · Magtheridon's Lair · World Bosses
P2  Serpentshrine Cavern · Tempest Keep · Crafted (Nether Vortex)
P3  Mount Hyjal · Black Temple · Crafted (Heart of Darkness)
P4  Zul'Aman
P5  Sunwell Plateau · Crafted (Sunmote)
```

All three levels are art, dim until picked (`--art-dim`), ranked by size: phase 148×72 >
zone 112×48 > boss 76×44. No counts or names on the face of anything with art; both stay in
`aria-label`. Bosses with no journal art (`.chip--noart`) keep their name. Searching does
not cross phases, by decision.

Why → [phase-zone-boss.md](docs/decisions/phase-zone-boss.md)

### Class, spec, and the two toggles

Class and spec strips are the last row of `.controls--where`. Both multi-select; a spec is
a refinement of its class, never a selection on its own. Icon-only, no counts. A row
matches through `selectionHas()`: a class entry stands for all its specs, a spec entry
satisfies its class. **An empty priority matches nobody.** A row the open list never
mentions is reachable through its BiS (`bisOnlyMatch()`) — but only while reading a list
that is not yours.

**Clicking a spec icon in the table filters to it** (`focusOn()`); never in the editor.

- **`BiS only`** — end of the spec strip, once a spec is picked. Filters on `bisPick()`.
- **`Meta Specs Only` / `All Specs`** — end of the class strip, on by default,
  `lootprio.metaOnly`, not in the url. Hides the seven non-meta specs from the chip row and
  both priority columns. **Never from rows, never a class entry, never a spec you selected,
  never in the editor.** `visiblePriority()` repairs operators across a dropped entry.

Why → [class-spec-filter.md](docs/decisions/class-spec-filter.md),
[meta-specs.md](docs/decisions/meta-specs.md)

### URL state

Hash: `phase`, `zone`, `boss`, `bossZone` (only when the boss name is ambiguous — both P3
raids have `Trash`), `class`, `spec`, `bis`, `role`, `type`, `slot`, `q`, `sort`, `list`,
`t`. Unknown identifiers are dropped on read. **`writeUrl()` must preserve
`location.search`** — the OAuth redirect lands in it.

---

## 4. Lists and editing

**A list is never mutated in place; edits live in an overlay.** Everything that asks what
a row says goes through `effectivePriority(rec)` / `effectiveNotes(rec)`, never `rec.priority`.

```js
var activeTemplate = null;   // the list being VIEWED
var activeIsMine   = false;  // is it in your store? false for one from a link
canEdit() === activeTemplate && activeIsMine && state.editing
```

Three views: a shipped list, a list from a link (both read-only reference), a list in your
own store (a workspace). You get one of your own by **New** (blank, seeded from BiS for
every phase, only filling empties; notes not seeded) or **Make a copy** (deep-copies what is
on screen; does not seed). `Edit` / `Done` toggles `state.editing`; `#edit-pill` is the way
out from 700 rows down.

**A template** is a full copy of all priorities and notes, `{ id, name, created, v, base,
author?, priorities, notes? }`, frozen at creation. `validateTemplate()` enforces the same
rules as `check_priority.py`, and a template from a link is untrusted input.

**Storage** is `store = { list, load, save, remove }`, async, `localStore` or
`remoteStore` (Supabase). **Signed out is the whole product**; sign-in is an upgrade that
follows your lists between machines, never a gate. Sign-in fails soft everywhere (no
config, blocked CDN, jsdom: no button, not a disabled one). PKCE flow, because the implicit
flow writes to the hash this site keeps its state in. **There is no Save button** — every
edit writes. A remote save is guarded by `updated_at`; zero rows back means someone else
wrote first.

**Sharing** is its own popover. Signed in → `?s=<token>` (128-bit, a **published snapshot**
the owner republishes; reads via a `security definer` function, writes only ever as the
owner). Signed out → `#t=` (the list itself, gzipped, frozen when copied).

**Editing is pointer-only**: drag to reorder, `×` to remove, click the operator to pick from
a menu, `+` for the add popover, click a note to edit it. `img.draggable = false` on every
icon, or the browser's own image drag cancels the gesture. **Reordering has no automated
coverage** — jsdom cannot drag; check it by hand.

Why → [edit-mode.md](docs/decisions/edit-mode.md),
[storage-and-auth.md](docs/decisions/storage-and-auth.md),
[list-bar.md](docs/decisions/list-bar.md), [sharing.md](docs/decisions/sharing.md),
[editing-gestures.md](docs/decisions/editing-gestures.md)

---

## 5. Conventions that break

Each of these has bitten at least once. The reasoning is in
[layout-conventions.md](docs/decisions/layout-conventions.md).

- **Never a bare element selector in `style.css`.** Wowhead's tooltip script injects its own
  DOM; a bare `table {}` once pinned every tooltip to 940px.
- **An author `display` beats `[hidden]`.** Anything hidden with the attribute must not set
  `display`, or must pair it: `.x:not([hidden]) { display: flex }`. Three times.
- **Don't hide table cells with `display: none`** — `table-layout: fixed` shifts the columns.
  Don't generate the column instead.
- **`title` has a ~1s delay.** Tooltips are `data-tip` + a `.tip` parented to `<body>`.
- **Data fetches use `cache: "no-cache"`**, and data ships in the same deploy as code, so a
  cached `app.js` can never disagree with the data it reads. Don't move data to a database.
- **Verify icon urls return 200 before wiring them.** Journal art slugs are irregular.
- **Slot and Type menus are drawn by the page**; the native `<select>` stays as the source of
  truth and is hidden only once its trigger is built.
- **`.list-zone` carries the one `margin-left: auto`**; the no-list warning is its sibling,
  never its child. `#edit-toggle` has its own.
- **The spec strip scrolls, never squashes**: `flex: none` on icons, `overflow-x: auto`,
  `flex-wrap: nowrap`, all three.
- **Only `.controls--refine` is sticky.** `.scroll` is already a scroll container (its
  `overflow-x` makes the other axis `auto`), so sticky sticks to *it*.
- **No accent on the picker.** `--gold` (`#86cf3e`, fel green) means *selected*. The BiS
  ladder colours mean their tiers. Nothing else on the page is warm.
- **No browser dialogs.** No `prompt`, `confirm`, `alert` — the tests grep for them.
- **Every art surface uses `--art-dim` / `--art-dim-hover`**, never a literal filter.
- **A rule three languages share lives in `data/rules.json`, never in code.** Operators,
  capacity, variants, phases. A "must stay in step" comment is not a guard.
- **Every new template field needs three things**: the upsert column, the SQL the RPC
  selects, and `rowToTemplate()`. An upsert silently drops what it does not name.

---

## 6. Tests

`npm test` — **use it, never grep its output for `FAIL`**: a file that crashes prints no
`FAIL` line and looks like a clean run. Six files, all against the **source**:

| File | Covers |
|---|---|
| `smoke.mjs` | Render, filter, sort, group, icons, operators, rings, tooltips, data invariants, stylesheet-text guards |
| `bis-fallback.mjs` | Missing or malformed `bis.json` / aliases degrade gracefully |
| `edit-mode.mjs` | Read-only vs editable, New/copy/menu/delete, the click paths, `ALL` never mutated |
| `templates.mjs` | Full copy, blank is valid, storage and `#t=` round-trip, eight bad templates refused |
| `auth.mjs` | A fake Supabase that is a working table; fail-soft states; the save guard; `?s=` recipients; no service-role key in the repo |
| `build.mjs` | `dist/` boots, and holds exactly `index.html`, `style.css`, `app.js`, `data/` |

**Counts are counted, not pinned**: `P3_TOTAL` and `countIn()` derive from the data.
Type-bucket counts stay literal because deriving them would reimplement `typeGroup()`.
Every file boots the page through `siteFetch()` from `test/helpers.mjs`, which serves the
data files by url and **404s anything it does not know** — so a new data file the page
asks for fails loudly in every test rather than being answered with the loot array.

**Waiting**: `until(pred)` / `settle()`, never a fixed sleep. The predicate must cover what
the *next line* needs, be about the new state, and a "did not happen" assertion cannot be
polled — those keep a `sleep` with a comment. Assigning `location.hash` queues a jsdom
hashchange; drain it.

Untestable in jsdom, check by eye: item icons and tooltips (Wowhead's script), the drag,
the OAuth redirect.

Why → [testing.md](docs/decisions/testing.md)

---

## 7. The pipeline

Importing loot, in order — every tool is a dry run until `--write`:

```bash
python3 verify/scrape_drops.py                      # guides -> a drops file; refuses unknown headings
python3 verify/fetch_items.py --drops <file>        # + the item database -> rows; drops below-epic
python3 verify/fetch_bis.py                         # every spec, every phase -> bis.json
python3 verify/seed_priority.py                     # a starting order for new rows
python3 verify/regroup.py                           # zone, then kill order
python3 verify/check_priority.py && python3 verify/check_bis.py
```

`fetch_bis.py` **never writes `loot_data.json`** and never edits a priority. It captures
each guide row's rank, item, **source cell**, slot heading and blurb. `dump_bis_raw.py`
writes all of that to `verify/bis-raw.json` (gitignored, 15 MB) for review.

**Finding missing loot**: cross-reference every id the guides name against
`loot_data.json`, grouped by the Source cell. A tier piece needs a `tier-tokens.json`
entry; a boss drop needs a row; a Sunmote upgrade goes under `Crafted (Sunmote)`; PvP,
profession, vendor and 5-man gear stay out.

One-shot tools kept as audit trail: `migrate_priority.py`, `fetch_unique.py`, `apply.py`,
`seed_roles.py`, `split_lists.py`.

---

## 8. Build and publish

`build.mjs` → `dist/` = minified `app.js` (identifier renaming is safe: no `eval`, one
IIFE, no globals), minified `style.css`, comment-stripped `index.html`, `data/` verbatim.
`.github/workflows/pages.yml` runs `npm ci` → `npm test` → `npm run build` → deploy, so a
red suite cannot reach the live site.

**Pages must stay on "GitHub Actions".** On "deploy from a branch" it serves the repo root,
and this file, `test/` and `verify/` go public. `curl $SITE/CLAUDE.md` returning **404** is
the one-line proof.

Why → [build-step.md](docs/decisions/build-step.md)

---

## 9. Attribution — required, keep it prominent

The shipped priorities are the work of **[zatar_wow](https://twitch.tv/zatar_wow)**,
reconstructed from two videos ([Mount Hyjal](https://www.youtube.com/watch?v=B3zgswtk6T8),
[Black Temple](https://www.youtube.com/watch?v=6SWlWDYTkvU)); bow priorities credited to
**Veramos**, arms input to **Lemonism**. Item data from [wowsims/tbc](https://github.com/wowsims/tbc);
icons and tooltips from [Wowhead](https://www.wowhead.com/tbc); BiS from Wowhead's per-spec
guides (urls in `verify/bis-sources.json`) and wowsims presets.

**The footer is the only place naming the source**, and `test/smoke.mjs` asserts it stays.
Lists carry an `author` stamped from the account; a byline is shown only for a list that
came out of the database under its owner's id (`attestedAuthor()`), never for a `#t=` link.
**The BiS rings are not zatar's** and must never be presented as if they were.

Why → [attribution.md](docs/decisions/attribution.md)

---

## 10. Working agreements

These are rules about how to **work** on this repo. They live here because this file is
the only thing that travels between machines.

### Never push, merge or deploy without being asked

**Work stops at a local commit.** No `git push`, no merge to `main`, no PR opened or
merged, no Pages deploy, without being asked for **that specific change**. Permission to
ship one change never carries to the next. Branch, commit, stop, say what is ready. If on
`main`, branch first.

### The ship route, when asked

1. `git diff --stat main...HEAD -- data/` — empty unless the change is deliberately a data
   change. **`data/lists/` never moves by accident.**
2. `git push -u origin <branch>` → `gh pr create` → `gh pr merge --merge --delete-branch`
3. Watch **`Deploy site`** with `gh run view <id> --json status,conclusion,jobs` — not
   `gh run watch`, which can drop its connection and exit 0.
4. **Verify live by fetching**: `curl $SITE/CLAUDE.md` → 404; `diff <(curl -s $SITE/app.js) dist/app.js`.

### Two traps

- `npm test`, never grep for `FAIL`.
- `npm install` on a fresh clone; esbuild is a dependency.

---

## 11. Known gaps

- **WoWSims source covers P4–P5 for 20 of 28 specs.** Choosing it on P1–P3 rings nothing,
  honestly. Filling it means extending `fetch_bis.py`.
- **`Crafted (Nether Vortex)` has no items** — crafted gear is not in the raid loot guides.
- **Zul'Aman trash drops** are missing.
- **Seeding is automatic and unrepeatable.** A list keeps the lines it was born with;
  re-seeding on demand is the obvious next move and the primitive already only fills empties.
- **`roles` on imported rows are stats-derived**; `seed_roles.py` is the better source and
  has not been re-run since the P1/P2 import.
- **The editor is not keyboard-operable** and reordering has no automated coverage.
- **The BiS wording review** is ongoing, spec by spec, through `rank-map.json`. The
  actionable backlog is rows ranked literally `Best`/`BiS` that sit blue because the slot
  was full — a few hundred across 27 specs.
- **`positions()` is unused.** A rank display was planned and not built.
- Pagination was considered and declined; reach for `content-visibility: auto` on
  `.boss-group` first if rendering ever matters.

Why → [known-gaps-history.md](docs/decisions/known-gaps-history.md)
