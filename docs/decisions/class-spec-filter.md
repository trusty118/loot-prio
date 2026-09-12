# The class/spec filter

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

### The class/spec filter

Two chip rows, Class then Spec, sitting in the filter panel to the right of the search box
(`.who-inline`) — see §4 for how the controls are split. They answer the
other question the table can be asked: not "who gets this item" but "what should I be
rolling on".

**Both rows are multi-select** (`state.classes`, `state.specs`), because a loot council
reads several classes at once. The spec row is `hidden` until a class is picked and then
offers exactly the selected classes' specs — grouped in the order the classes were picked,
not registry order.

**A row the open list never mentions is reached through its BiS, not through a priority.**
It names nobody, so `selectionHas()` can never match it; `bisOnlyMatch()` lets it through
when the item is BiS for a spec the selection stands for. Otherwise Band of the Eternal Champion would be BiS for eight
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
