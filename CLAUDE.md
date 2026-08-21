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
npm test             # 468 checks, should be all green
python3 -m http.server 8642 --bind 127.0.0.1   # then open http://localhost:8642
```

Needs `node` and `python3`. `gh` is optional (only used to poll the Pages build).

**On Windows** `python3` is not on PATH — use `py` for both the server and the validators
(`py verify/check_priority.py`). `npm run serve` still assumes `python3`.

**Always view over HTTP**, never by opening `index.html` from disk — the page `fetch`es
its data and will show a load error otherwise.

---

## 2. The data

### `data/loot_data.json` — 195 items, the source of truth

Flat array, grouped in the file by zone then boss in kill order, so a boss's items sit
together for hand-editing.

| Field | Meaning |
|---|---|
| `zone` | `Black Temple`, `Mount Hyjal`, `Crafted (Heart of Darkness)` |
| `boss` | Boss name, `Trash`, or `—` for crafted (rendered as its zone, not as a boss) |
| `item` / `id` / `wowhead` | Name, real TBC item ID, Wowhead link |
| `slot` | `Head` … `Two-Hand`, `Ranged`, `Relic`. Collapsed for display: all weapon slots → `Weapon`, `Ranged`+`Relic` → `Ranged/Relic` |
| `type` | Armour class or weapon type. Displayed with tidy-ups: `2H Staff` → `Staff`, bare `Mace` → `1H Mace` (hand count derived from slot) |
| `roles` | What the item is *for*: any of Physical / Caster / Healer / Tank / Tier, **as a list**. Drives the editor's smart filtering, feeds search, and its first value tags the row as `data-role`. Not rendered — see §6 |
| `priority` | Ordered list of entries, each naming the operator linking it to the previous one — see §3 |
| `notes` | Caveats. All conditional wording lives here, never in `priority` |
| `unique` | `true` only on the 23 unique items. **Absent means not unique** — see Repeats in §3 |
| `unsourced` | `true` on the 13 items the source guide never covered. **Absent means it is zatar's** |

**`priority` is structured data, not prose.**

**An empty `priority` means two different things, and they must not be conflated.** On the
182 records that came from the videos it means zatar gave a call and the call was "whoever
needs it" — his wording lives in `notes`, and 23 rows are like this. On the 13 `unsourced`
records it means he never mentioned the item at all; they were found by auditing Wowhead's
BiS guides against this dataset (see `verify/missing-items.md`) and they render with a
**"not in the guide"** tag, because a row carrying none of his calls must not read as one he
had no opinion on. `check_priority.py` enforces the distinction: an empty priority with
neither `notes` nor `unsourced` is a warning, and `unsourced` on a record that *has* a
priority is an error — if someone later records a call for one of these, the marker comes
off in the same edit.

**`roles` replaced the single-valued `role`, Aug 2026.** One word could not say that a plate
piece is wanted by both a Retribution and a Protection Paladin. It was seeded by
`verify/seed_roles.py` from two sources — the specs that call an item BiS in `bis.json` (116
items), and the old `role` for the 79 nothing ranks — then reviewed by hand. `check_priority.py`
enforces that every record carries a non-empty list drawn from the five, and that **no cloth item
is ever tagged `Physical`**, which is what keeps rogues and hunters off robes in the editor.

### `data/specs.json` — the class/spec registry

```json
"specs": { "ProtWarr": { "class": "Warrior", "name": "Protection Warrior",
                         "icon": "ability_warrior_defensivestance", "roles": ["Tank"] } }
```

Five sections: `classes` (9), `specs` (28 pickable, plus the `FeralDruid` umbrella),
`forms` (Feral bear/cat, each pointing at the spec it resolves to),
`races` (Orc/Human), and `aliases` (the old priority shorthand → id).

`aliases` is used by `verify/migrate_priority.py` and by `check_bis.py`'s "did you mean"
hint. **It is loaded into `app.js` and read by nothing** — search builds its haystack from
`priorityText()`, which resolves full names, so `Boomkin` and `SPriest` currently match no
rows. Either wire it into the search haystack or drop it from `indexRegistry()`; leaving it
loaded but unread is what made this look done when it wasn't.

**The key (`ProtWarr`) is the identifier every other data file stores; `name` is display
only.** Renaming a label never touches a data file. Adding a spec is a data edit, not a
code edit — check the icon returns 200 first.

**A spec's `roles` are the kinds of loot it gears for, not what it does in a raid.** That
distinction is load-bearing for smart filtering: `ProtPal` carries `Caster` because spellpower
was its threat stat, `ProtWarr` carries `Physical` for threat weapons, `FeralBear` carries
`Physical` because bears gear from agility leather, and `FeralCat` carries `Tank` because cat and
bear share the same pieces. Fixing these on the **spec** is why almost no item needs a
hand-written exception — the alternative was tagging every caster item `Tank` so a Prot Paladin
could see it.

**Umbrella specs.** A spec with `covers` stands for the specs it names instead of being one
itself. `FeralDruid` covers `FeralBear` and `FeralCat`, because the two gear so differently
that one BiS set can't serve both — Pillar of Ferocity is expansion-long for bear and not
BiS at all for cat. The priorities go on naming `FeralDruid`, so it stays a valid
identifier and no priority was rewritten; it just holds no BiS set and is not offered as a
filter chip. Its icon behaves like a class icon: it rings for whichever covered spec has
the item, and narrows when you pick one. The `forms` entries carry `spec`, so a priority
entry of `FeralDruid` + `form: "cat"` resolves straight to `FeralCat`.

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

**366 entries across all 28 specs, and it is generated** — `python3 verify/fetch_bis.py`
builds it from the sources in `verify/bis-sources.json`, which names one Wowhead Phase 3
guide per spec. Hand edits survive a re-run: an entry already in the file keeps its `bis`
value, and anything the guides no longer corroborate is kept and reported rather than
dropped. Dry run by default, `--write` to apply, `--only <specs>` and `--verbose` while
working on one spec.

Two things the tool will not do, by design. It **never writes `data/loot_data.json`** —
a BiS item this site doesn't list is reported and dropped, never added, because adding
items is a separate job with its own evidence (see §6). And it never edits a `priority`:
those are zatar's calls, and BiS is a layer on top of them.

The rank column in those guides has no fixed vocabulary — 140 rows say `BiS`, but tank
guides rank by purpose (`Best Threat`, `Best Mitigation`) and healers by build
(`Regen BiS`, `BiS - Haste`). `RANKED_BIS`/`NOT_BIS` in the tool encode the rule: lead with
"Best" or name "BiS" anywhere, unless qualified into something else (`Option`,
`Alternative`, `Pre-Raid`, `PvP`, `Best Until Tier 6`). `Near Best` and `Second Best` fail
the leading-word test deliberately.

The tier is **derived, not guessed**: an item still in that spec's wowsims/tbc P4 preset is
`multiPhase`, one that survives to P5 is `expansion`. Eight specs have no wowsims preset —
`HolyPal`, `Marks`, `Disc`, `HolyPriest`, `RestoShaman`, `AffliLock`, `DemoLock`,
`RestoDruid` — so their entries stay at `phase`, and the tool suppresses tier "conflicts"
for them, since a default is not a derivation to disagree with.

---

## 3. How the priority column renders

`priority` is an ordered list. Each entry names a `spec` or a `class` from
`data/specs.json`, plus the `op` that links it to the entry before it:

```json
"priority": [
  { "class": "Rogue" },
  { "spec": "Enh",  "op": "=" },
  { "spec": "Arms", "op": ">>" },
  { "spec": "Fury", "op": ">", "race": "Orc" }
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

**A class icon carries the rings of the specs behind it.** `bis.json` is keyed by spec, but
104 of the 398 priority entries name a *class*, so an item that is BiS for Arcane usually
sits on a row that says `Mage`. `bisMark()` resolves this: a spec icon answers for itself,
and a class icon takes the **highest** tier among its specs. Who the ring is for belongs to
the icon, not the ring, so it goes on the tooltip's **name line** — `Priest — Discipline,
Holy` above a plain `Phase BiS` — and the specs drop the class name the icon already shows.
It matters: of 366 entries, most rings land on a spec icon and around 120 on a class icon.

While a filter is on, only the **selected** specs count toward a class icon's ring, so it
answers "is this BiS for me" rather than "for someone in this class".

A ring still can't appear when the priority names neither the spec nor its class.
`check_bis.py` summarises those as "not visible" — 115 entries across 43 items; pass
`--verbose` for the list. 18 of the items have an empty priority, where there is no icon
to ring at all; the other 25 name other specs.

**That gap is deliberate: never close it by adding specs to `priority`.** zatar is coarser
than per-spec BiS — he never mentions Marksmanship, so items that are MM BiS list only BM
and Survival. `priority` is *his* ordering and is going to be loadable as a template, so
appending the missing spec icons would look like a tidy fix while quietly rewriting the
source guide. Players wanting an MM list will build their own once templates exist.

Every icon carries `data-id` with its registry identifier, so nothing downstream has to
recover it from the display name — forms make that lossy (`Feral Druid (cat)`).

`specs.json` and `bis.json` both **fail soft**: a 404 or malformed file costs the icons or
the rings, not the page.

### The class/spec filter

Two chip rows, Class then Spec, sitting in the filter panel to the right of the search box
(`.who-inline`) — see §4 for how the controls are split. They answer the
other question the table can be asked: not "who gets this item" but "what should I be
rolling on".

**Both rows are multi-select** (`state.classes`, `state.specs`), because a loot council
reads several classes at once. The spec row is `hidden` until a class is picked and then
offers exactly the selected classes' specs — grouped in the order the classes were picked,
not registry order.

**An `unsourced` row is reached through its BiS, not through a priority.** It names nobody, so
`selectionHas()` can never match it; `unsourcedBis()` lets it through when the item is BiS for
a spec the selection stands for. Otherwise Band of the Eternal Champion would be BiS for eight
physical specs and reachable from none of them. The row keeps its empty priority column and
its tag, so nothing about it reads as one of zatar's calls, and an unsourced item that is BiS
for nobody (Wraps of Precise Flight) is surfaced by no filter at all. `SELECTED_SPECS` is
rebuilt once per `update()` rather than per record, since `matches()` runs across every row for
every chip.

A spec is a **refinement of its class, never a selection in its own right**: deselecting a
class drops any of its specs, and `pickedSpecs()` resolves each class separately before
unioning. Picking Mage + Warlock and then narrowing Mage to Fire leaves Warlock whole —
27 rows become 26, not 18. A `?spec=` link with no `class=` adds the implied class on read.

Those chips are **icon-only** (`chip(..., iconOnly)` adds `.chip--icon`): with a name and a
count on each of 27 chips, the icons being recognised were buried. The name moves into the
chip's `data-tip` and `aria-label`, and is what tests match on since these chips have no
text content. **No count on them** — you scan this row to find your class, and 27 numbers
are noise next to the result total already sitting above the table.

A row matches through `selectionHas()` in `app.js`, which asks whether any priority entry
speaks to the selection (`priorityHas()` is the single-class form underneath it):

- a `class` entry (`Mage`) stands for **every** spec of that class, so it matches Arcane;
- a `spec` entry satisfies a selection of its own **class**, so `Fire` matches Mage.

104 of the 398 entries are class-level, so both directions matter. **An empty priority
matches nobody**, which is how the 23 "whoever needs it" rows drop out while a filter is
on: the filter asks where you stand in a line, and those rows name no line.

Everyone else in each line is dimmed (`.spec-icon--muted`) rather than removed — the ranking
is the point, so the rest of it has to stay readable. Dimmed icons keep their tooltips.

**`BiS only`** is a toggle chip at the end of the spec row, offered only once a spec is
picked: `bis.json` is keyed by spec, and a class-wide union of nine specs' lists would mean
nothing. It filters on `bisTier()`, not on the rings, so it still finds items that are BiS
for a spec the priority never names (the "not visible" case `check_bis.py` warns about).
With several specs picked it keeps anything BiS for any of them.

### URL state

Filters live in the hash: `zone`, `boss`, `bossZone`, `class`, `spec`, `bis`, `role`,
`type`, `slot`, `q`, `sort`. `class` and `spec` are comma-joined lists, checked against the
registry on read, so a stale identifier is dropped rather than filtering every row away.

`bossZone` exists because boss names are **not unique across zones** — both raids have a
`Trash`. Boss chips are identified by zone + boss, and it is written only when the name is
ambiguous, so the other 14 bosses keep the short URL they have always had. An old bare
`boss=Trash` link carries no `bossZone` and keeps its original both-zones behaviour.

## 4. Edit mode — your own priority list

> **Reworked and finished, Aug 2026.** [docs/edit-mode-plan.md](docs/edit-mode-plan.md) records
> what changed and why, including two decisions that are easy to undo by accident: the
> `.prio-grip` handle was **dropped** once the real drag bug was found, and the drag itself is
> **only ever verified by hand** — jsdom cannot reach the gesture, so a green suite says nothing
> about it. Re-check by hand if you touch the drag machinery.

The whole data restructure was aimed at this. `priority` became an ordered list of
`{spec|class, op}` entries so a person could reorder icons and pick operators.

**zatar's data is never mutated.** `ALL` stays exactly as loaded, so "back to his order"
is always one click away and a template can be diffed against the original. Edits live in
an overlay:

```js
function effectivePriority(rec) {                       // the template's, else the guide's
  return (activeTemplate && activeTemplate.priorities[rec.id]) || rec.priority;
}
```

**Everything that asks what a row says goes through that**, never `rec.priority`: both
priority cells, `selectionHas()`/`priorityHas()` behind the class/spec filter, and the
search haystack. Two deliberate exceptions read `rec.priority` precisely because they want
the original — the reset button, and whether to offer one.

### Whose list is on screen

Three views, one variable and one flag:

```js
var activeTemplate = null;   // the list being VIEWED; null means zatar's
var activeIsMine = false;    // is it in your store? false for one from a #t= link
```

**zatar's list is read-only reference, and so is a list that arrived on a link.** Only a
list in your own store is a workspace — `canEdit()` is `activeTemplate && activeIsMine &&
state.editing`, and it is what `renderRow` and `renderPalette` gate on. You get one of your
own two ways, the way Office does it:

- **New** → `newBlankTemplate()`, all 195 rows with every priority empty, `base: "blank"`.
- **Make a copy** → `copyOfCurrent()`, which deep-copies `effectivePriority(rec)` for every
  record. That one function copies the guide's list, one of yours, or a shared one, without
  branching on which — and it is the only way to keep someone else's link.

`state.editing` survives as an **Edit / Done** toggle, but only appears once a list of yours
is open: a finished list gets read during a raid, and it should not be covered in `×`s. It is
cleared by every view change (`openTemplate()` is the single place that happens).

**An `unsourced` row is reachable through its BiS only while reading the guide.** That path
bridges a gap in *his* data; with a list of your own open there is no gap, and letting 13
rows through a filter the other 182 fail would make your own list lie about itself.

### What a template is

```json
{ "id": "t_9f3c", "name": "MM hunter list", "created": "2026-08-20",
  "v": 1, "base": "zatar", "priorities": { "32375": [ { "spec": "ProtWarr" } ] } }
```

A **full copy** of all 195 priorities, not a diff — 11.6 KB of JSON, **2,263 characters**
gzipped and base64url'd, which fits a URL comfortably. Two consequences, both handled
rather than hidden:

- **It is frozen.** Later corrections to `loot_data.json` don't reach a saved template;
  `base` and the date are stored so the UI can say so.
- **Items added later aren't in it.** Anything missing renders from `loot_data.json` and is
  marked as not part of this template, never silently blank (`inTemplate()`).

A **blank list is a template like any other** — it validates, saves and shares; an empty
priority is valid data, not a broken one. Its consequence is that it matches no class or spec
filter, so the chips all read zero. That is honest, and `blankListFiltered()` makes the empty
results say so rather than look broken. **Don't paper over it by extending `unsourcedBis()`.**

### Storage

```js
var store = { list(), load(id), save(t), remove(id) };   // localStorage now, Azure later
```

**Async from the start** even though localStorage is synchronous, so the Azure Functions +
Cosmos implementation is a drop-in rather than a refactor of every call site. That is the
entire reason edit mode was built before login.

**There is no Save button.** A list is written when it is made and again on every edit
(`saveNow()`), so it is in the dropdown from birth and nothing is lost by forgetting to press
something. The name field is the one thing debounced, at 400 ms, because it fires per
character. Whether a write is outstanding lives in a module-level `unsaved`, deliberately
**not** on the template — so scratch state never travels into the store or into a share link.

### The bar

```
[ List ▾ ]  [ name______ ]   New   Make a copy   Edit   Copy link   Delete
```

What it offers follows what is on screen: zatar's list and a shared list get New and Make a
copy and nothing else; the rest appears once a list of yours is open. `savedLists` caches
`store.list()`, refreshed by `refreshLists()`, which calls `renderTemplateBar()` **directly
and never `update()`** — `update()` is what calls `renderTemplateBar` in the first place.

**No browser dialogs anywhere.** Naming is a field, opening is the dropdown, Delete asks in
place (`Delete` → `Sure?`, taken back by any other bar click), and a missing clipboard API
reveals the link in a selected field. `test/edit-mode.mjs` asserts against the source that no
`window.prompt` or `window.confirm` has crept back.

### Sharing by link

`encodeTemplate` / `decodeTemplate` gzip via `CompressionStream` and base64url into `#t=`.
The `z` prefix marks gzip, `r` raw base64 for browsers without it. In the **hash fragment**
it never reaches a server.

A template from a link is **untrusted input**. `validateTemplate` enforces the same rules as
`verify/check_priority.py` — identifiers resolve, operators are among the five, the first
entry has no `op`, no illegal repeats — and refuses with a readable message rather than
rendering a broken table. `test/templates.mjs` hand-crafts one violation of each.

It opens as **reference, not as yours**: the dropdown says `Shared: <name>`, nothing of theirs
is written to your store, and Make a copy is how you keep it.

### The editing gestures

| Action | Pointer | Keyboard |
|---|---|---|
| Reorder | drag the icon along its line | ← → |
| Remove | the × | Delete |
| Operator | click the `>`, pick from the menu | Enter (steps) |
| Add | `+`, then click an icon or drag one onto any line | `+`, type, Enter |

Pointer events, **not HTML5 drag-and-drop** — these icons sit in a `table-layout: fixed`
cell, where HTML5 drop targets are unreliable. A press only becomes a drag past
`DRAG_SLOP` (4px), so a click still reads as a click.

**An `<img>` is natively draggable, and that broke every drop in the editor.** Pressing and
moving started the browser's own image drag, which fires `pointercancel` and tore down the
pointer sequence this all runs on — and `onDrag` abandoned the drop in silence, so it looked
like nothing happened. `specIcon()` sets `img.draggable = false` (with `-webkit-user-drag`
beside it in the CSS), and a cancelled drag now says so through `console.warn`. **Never render
a draggable icon without that**, and don't put the silence back.

**Dragging clear of the row no longer removes.** It fired by accident far more than on
purpose, and it was invisible for as long as dragging itself was broken. A drop anywhere but
on the icon's own line returns it home; removal is the × and the Delete key, both deliberate.

**Adding is a popover, not a bar.** The `+` on a row opens `.prio-pop` — a search field and
every class and spec, parented to `<body>` for the same reason the tooltip is (inside the
cell, the table's scroll container would clip it). Clicking an icon adds it to that row;
**dragging one lands on whichever row you drop it on**, at the gap you drop it in, because
`cellUnder()` resolves what is under the pointer and doesn't care where the drag began.
`markSlot()` marks the icon a drop would land before — or the cell itself when the line is
empty, which is every row of a list you have only just started.

**The operator is picked, not cycled.** Clicking it opens `.prio-menu` — the five, worded from
`OPERATORS[op].label`, with the current one marked — so `~=` is one click rather than four.
`setOp(list, at, op)` is the primitive and `cycleOp()` delegates to it, because Enter on an
entry still steps: there is nothing to aim at on a keyboard. The menu and the add popover share
`placeUnder()` for anchoring, so the two can't drift into two versions of the same arithmetic,
and both close on Escape, on a click away, on leaving edit mode, and on opening another list.

**Smart filtering: two layers, and they are not the same kind of rule.** `suitsItem()` decides
what the `+` popover offers.

1. **Proficiency is hard.** A class wears its own armour type and everything below it —
   Cloth < Leather < Mail < Plate — so a Mage is never offered leather and a Hunter never plate;
   `Idol`/`Totem`/`Libram` belong to Druid/Shaman/Paladin alone. Measured against zatar's 398
   entries this excludes **none** of them, and `check_priority.py` now fails if the data ever
   contradicts it. **A naive equality rule would have flagged 72** — he routinely puts Boomkin
   and Ele on cloth and Holy Paladins on mail, which is normal TBC gearing, so never write
   `item.type === class.armor`.
2. **Role tags are advisory**, and run on whoever survived layer 1: the item's `roles` must meet
   the spec's. The same crossing contradicts **59** of his own calls — a Prot Warrior on a
   physical weapon, an Enhancement Shaman on a healer ring — which is exactly why the popover
   **hides** rather than refuses, and why `rejectReason()` is untouched by any of this. Dragging
   is not restricted at all.

Cloth is layer 2's work, not layer 1's: anyone can physically wear cloth, and rogues stay off
robes only because all 24 cloth items are tagged Caster/Healer.

**`Show all specs` is in the popover**, not on the bar — it is a decision about the pick you are
making. It disappears when the item suits everyone, since there would be nothing to reveal, and
the choice persists in `lootprio.smartFilter`. The popover carries no line naming the item: it
opens anchored under that row's `+`, so saying so again was repeating what you can see. The name
is on the dialog's `aria-label`, for the reader that cannot see where it opened. Weapon proficiency (no Priest with a polearm) is the obvious next
layer of the same kind and is not built.

**Every gesture has a keyboard form**, which is both the accessibility requirement and the
only reason the editor is testable — jsdom can dispatch a keydown but cannot drag. Dragging
itself is checked by hand at `localhost:8642`.

**The repeat rule is enforced in the editor, not just the validator.** `allowsRepeat()` is
the JS port of the rule in `check_priority.py`: a spec may appear twice only when the item
is a `Finger`, `Trinket`, `One-Hand`, `Main-Hand` or `Off-Hand` and is not `unique`. The
editor refuses the drop and says why, so it cannot produce data that fails validation later.

## 5. Conventions that are easy to break

- **Never use a bare element selector in `style.css`.** Wowhead's tooltip script injects
  its own DOM into the page. A bare `table { min-width: 940px }` once matched their
  tooltip tables and pinned every item tooltip to 940px wide — and `min-width` beats
  `width` and `max-width`, so no override could fix it. Scope to `.boss-group table`.
- **A `display` rule beats the browser's `[hidden]`.** It has bitten twice: once on
  `.control-row`, once on `.tpl-link-out`, where it left the share-link box permanently on
  the bar. Anything the code hides with `hidden` must either never set `display`, or pair it
  with the attribute — `.x[hidden] { display: none }` or `.x:not([hidden]) { display: flex }`.
  `test/smoke.mjs` checks this against the stylesheet **source**: jsdom does not load external
  CSS, so a `getComputedStyle` check would pass no matter what the rule said.
- **Don't hide table cells with `display: none`.** The tables are `table-layout: fixed`;
  hiding a cell makes the rest shift into the wrong columns. Don't generate the column —
  that is how the Role column was removed.
- **`title` attributes have a ~1s browser delay** that can't be configured. Icon tooltips
  use `data-tip` plus a `.tip` element parented to `<body>` (inside the table it would be
  clipped by the scroll container).
- **Icon URLs are verified before use.** Everything comes from `wow.zamimg.com`; check a
  new one returns 200 before wiring it up. Boss portraits are Encounter Journal art
  (`ui-ej-boss-*.png`) with irregular slugs — `najentus`, `kazrogal`, no leading "the" on
  the Illidari Council.
- **Two control panels**: `.controls--where` (zone/boss) and `.controls--refine` —
  everything that narrows the table, which is type, slot, search **and who you are**. Class
  and spec used to have a panel of their own at the top; they are filters, so they sit with
  the filters, to the right of the search box, and `.field--grow` caps that box at 300px to
  make the room (you scan the icons, you type in the box occasionally).
- **Which list you are on lives in the banner**, top right, not in a panel: it is not
  filtering, and it applies to the whole page rather than to the rows below it. The split is what
  makes the last one read as narrowing the results rather than as another way of choosing
  them, so keep chip rows out of it. **Only `.controls--refine` is sticky** — it is the one
  adjusted while reading, it carries the count, and it sits directly above the results;
  two sticky panels would fight over `top: 0`.
- **Chip rows have no visible label**, and each leads with a bare `All` chip carrying no
  count, so the rows line up down one edge. What the row is, and what its All chip clears,
  live in `aria-label` (on the `role="group"`) and in `data-tip` — `allChip()` sets both,
  so a new row should go through it rather than calling `chip()` directly. Counts stay on
  the individual chips; the row total is already the `N of 195 items` line.

---

## 6. Tests

`npm test` runs four files:

- `test/smoke.mjs` — renders the page in jsdom and asserts filtering, sorting, grouping,
  icons, operators, BiS rings, tooltips and the data edits.
- `test/bis-fallback.mjs` — a missing or malformed `bis.json` degrades gracefully.
- `test/edit-mode.mjs` — that zatar's list is read-only and a list of your own is not; New,
  Make a copy, the dropdown, the name field, two-step Delete, and that an edit is in the store
  with nothing pressed to put it there. Then the editor through its keyboard and click paths:
  reorder, remove, operator cycling, the add popover and its search, the repeat rule, reset,
  and that `ALL` is never mutated. It also greps its own source — so a `window.prompt` can't
  creep back — and asserts **every icon carries `draggable="false"`**, which is the only part
  of the drag gesture jsdom can reach and the exact thing that was broken.
- `test/templates.mjs` — a template is a full copy, a blank one is valid and shareable,
  storage round-trips, the URL encoding round-trips, and eight kinds of hand-crafted bad
  template are each refused.

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

## 7. Known gaps

- **Missing items: closed, Aug 2026.** The old "20-30 more" estimate was wrong — it counted
  tier **set pieces** as missing loot. 71 BiS items were sourced to BT or Hyjal and absent
  here, but 62 were Thunderheart/Skyshatter/Lightbringer/Onslaught/Slayer's/Absolution/
  Malefic/Gronnstalker's/Tempest armour, which are what the 15 **tokens** turn into and are
  correctly not listed. The 8 real ones were added. Full audit in `verify/missing-items.md`;
  expect tier armour to keep showing as "not in this dataset" on every `fetch_bis.py` run.
- **Still not included:** gems, and Mother Shahraz's shadow-resistance set — intentional
  omissions by the creator — and tier set pieces, per the above.
- Planned but not built: alias-aware search, and a rank display for the unused
  `positions()`. See §2 and §4.
- **The Role column and filter were deleted, Aug 2026.** The class/spec filter answers the
  same question more precisely. The `role` field stays in `loot_data.json` and in the
  search index (typing "healer" still works), and still tags each row via `data-role`, but
  nothing renders it. "Tier Token" returned to the type dropdown at the same time — the
  Tier role chip had been the only way to reach those 15 items.
- Planned but not built: clicking a spec icon in a priority line to jump straight to that
  spec's filtered view. `BIS_BY_SPEC` in `app.js` is still unread by anything — the filter
  goes through `bisTier()` — and is the natural source for a "show me this spec's whole BiS
  list" view.

### Pagination — considered and declined, Aug 2026

All 195 items render on one page, in 17 boss groups: ~2,400 elements under `#results`. A full `update()` profiled in jsdom at ~180ms median, of which
**~82% is DOM construction** and ~0.1ms is the filtering logic. jsdom is roughly an order
of magnitude slower at DOM work than a browser, so the real cost is well under that.

**Wowhead's reason doesn't transfer.** Their list pages paginate a server-side query over
hundreds of thousands of items, where a page bounds both the query and the payload. This
site fetches one 72 KB JSON that is fully in memory before the first row renders, so
pagination cannot save a byte of network or parse cost — only DOM nodes per render, and
2,400 elements is not a number browsers struggle with. Against that it would cost
find-in-page across groups, cut boss groups at page boundaries (kill-order grouping is the
point of the layout), complicate the linkable-hash property, and break printing.

**If it ever does matter, reach for `content-visibility: auto` plus
`contain-intrinsic-size` on `.boss-group` first** — off-screen groups skip layout and paint
while staying in the DOM, searchable and linkable. Most of pagination's rendering benefit,
none of its behavioural cost.

Two inefficiencies found while profiling, both dwarfed by DOM construction at this size but
worth naming if the dataset grows several-fold: `bossSortKey()` calls `orderedBosses()` per
row, rescanning every record while grouping (n²), and each class/spec chip makes its
own full pass over the filtered pool (~36 passes per render).

---

## 8. Attribution (required, keep it prominent)

**The banner title is generic — "Classic WoW Loot Prios" — so the credit rides on the
tagline beside it**, and `test/smoke.mjs` asserts the banner names and links zatar_wow. A
title that no longer says whose calls these are is exactly how the attribution erodes by
accident, so if the banner is reworked again, the credit moves with it.

The priorities are the work of **[zatar_wow](https://twitch.tv/zatar_wow)**, whose site
`tbc.classicwowbuilds.com` has been offline for years. This is a community mirror, not
original analysis. Reconstructed from their two videos:
[Mount Hyjal](https://www.youtube.com/watch?v=B3zgswtk6T8) and
[Black Temple](https://www.youtube.com/watch?v=6SWlWDYTkvU). Hunter bow priorities were
credited in-video to **Veramos**, arms-warrior input to **Lemonism**.

Item IDs and slots came from [wowsims/tbc](https://github.com/wowsims/tbc). Icons and
tooltips from [Wowhead](https://www.wowhead.com/tbc).

**182 of the 195 rows are zatar's; 13 are not.** Those 13 are T6 items the videos never
mention, added in Aug 2026 so the loot tables are complete. They carry `unsourced: true`, hold
no priority, and render with a "not in the guide" tag so no reader mistakes them for his
calls. `verify/missing-items.md` is the record.

**The BiS rings are not zatar's either** and must never be presented as if they were — the
videos gave loot-council priorities, not per-spec BiS lists. `data/bis.json` comes from Wowhead's
per-spec Phase 3 (BT/Hyjal) BiS guides, one per spec, each URL recorded in
`verify/bis-sources.json`; how long an item stays BiS is derived from
[wowsims/tbc](https://github.com/wowsims/tbc) P4/P5 gear presets. Where the two sources
disagree with each other — 47 entries whose spec the priority never names — both are left
standing rather than reconciled.

Boss attribution for 52 Black Temple items was verified by hand against Wowhead in
Aug 2026 — 27 confirmed, 24 corrected. `verify/boss-attribution.csv` is the record.
