# `loot_data.json` — the item fields, and the two bugs that shaped them

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

### `data/loot_data.json` — 699 items, the source of truth

**It holds items, and nothing anybody ranked.** Priorities and notes used to live here,
because zatar's calls *were* the site: `activeTemplate === null` meant "showing zatar" and
everything a template did not hold fell through to `rec.priority`. That made him the
substrate rather than a list, and it made an item a template had never heard of quietly
render his call as if it were yours.

Since Aug 2026 a priority is something a **list** says. His 182 priorities and 177 notes
live in `data/lists/zatar-p3.json`; `unsourced` and `prioritySource` went with them, along
with the 268 SEEDED rows — every one of which was exactly the specs `bis.json` already
lists, so they duplicated data the page draws as rings. **With no list open the priority
column is empty**, which is the honest rendering of "nobody has ranked this".

A handful of `notes` stayed: facts about the **item** rather than anybody's opinion of it —
*"Also drops from Eredar Twins"*, *"Reputation reward from the Scale of the Sands"*. They
show whatever list is open, including none, because they are true either way.

Flat array, grouped in the file by zone then boss in kill order, so a boss's items sit
together for hand-editing.

| Field | Meaning |
|---|---|
| `zone` | `Black Temple`, `Mount Hyjal`, `Crafted (Heart of Darkness)` |
| `boss` | Boss name, `Trash`, or `—` for crafted (rendered as its zone, not as a boss) |
| `item` / `id` / `wowhead` | Name, real TBC item ID, Wowhead link |
| `slot` | `Head` … `Two-Hand`, `Ranged`, `Relic`. Only the weapon slots collapse for display, all four → `Weapon`. **`Ranged` and `Relic` are separate, Sep 2026** — see below |
| `type` | Armour class or weapon type. Displayed with tidy-ups: `2H Staff` → `Staff`, bare `Mace` → `1H Mace` (hand count derived from slot). Caster off-hands carry `Off-hand` — see below |

**A caster off-hand carries `type: "Off-hand"`, and getting there needed a rule keyed on
the RAW tooltip slot.** `fetch_items.py`'s `slot_type()` reads the two tooltip lines after
the bind line — slot, then type. An off-hand frill has **no type line at all**: the tooltip
goes straight from `Held In Off-hand` to the first stat. So nine records shipped with a
**stat as their item type** — `"+19 Stamina"`, `"+22 Intellect"` — which showed twice over:
the Type column read `+19 Stamina`, and since `typeGroup()` ends with *"everything left is a
weapon"*, they filed under **Weapons - 1H**, handing anyone filtering for one-handers nine
caster books.

`BY_RAW_SLOT` is the fix and it **cannot be folded into `BY_SLOT`**, which is the
obvious-looking home. `SLOT` flattens three raw strings onto one `Off-Hand`, and that slot
also holds 15 shields, 5 fists and a sword — all of which *do* carry a type line and would be
mislabelled by a blanket rule. Only `Held In Off-hand` means "frill with no type of its own".

`test/smoke.mjs` now fails on any `type` beginning with `+`, and on any armour-slot record
whose type is not a known one — the second being the assertion that would have caught these,
since the first only shows on rows somebody happened to look at.

**`Ranged` and `Relic` were one `Ranged/Relic` option until Sep 2026.** The argument for
merging them was that they share a paper-doll slot and no class has both, so splitting
produced two half-empty options. That was right about the character sheet and wrong about the
reader: they are one slot but not one *question*, and a hunter scanning for a bow and a druid
scanning for an idol were each handed the other's items. `Ranged` is guns, bows, crossbows,
thrown and wands; `Relic` is idols, totems and librams.

**The merge was also hiding a data error, which is the better reason it had to go.** With the
two collapsed, a slot that disagreed with its own type could never show on screen — and
*Tome of the Lightbringer* sat as `slot: "Ranged"`, `type: "Libram"`. A libram is a relic. It
is refiled, and `test/smoke.mjs` now fails on any relic type outside the `Relic` slot, or any
ranged type outside `Ranged`, so the next one cannot hide the same way.

Phases 4 and 5 hold no relics at all, so the option simply does not appear there —
`fillSelect()` lists what the phase has.
| `roles` | What the item is *for*: any of Physical / Caster / Healer / Tank / Tier, **as a list**. Drives the editor's smart filtering, feeds search, and its first value tags the row as `data-role`. Not rendered — see §6 |
| `notes` | **Facts about the item only** — where else it drops, how it is obtained. Opinions live in a list |
| `unique` | `true` only on the 23 unique items. **Absent means not unique** — see Repeats in §3 |
