# The Meta Specs Only toggle

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

### The meta-specs toggle

**`Meta Specs Only` / `All Specs`, at the end of the CLASS strip, Aug 2026.** Seven specs are marked
`"meta": false` in `specs.json` — Frost and Fire Mage, Subtlety and Assassination Rogue,
Marksmanship Hunter, Demonology Warlock, Discipline Priest — and the toggle drops them from
the chip row and from both priority columns. A raid leader gearing a real roster is never
going to rank a Frost Mage, and with no list open the BiS view was drawing up to **eleven
icons on one row**. On this data it takes the Phase 3 view from **327 icons to 247**.

**Absent means meta**, so the other 21 entries are untouched — the exception is marked, not
the rule, the way `unique` is in `loot_data.json`. Adding or removing one is a data edit and
nothing else. `check_priority.py` rejects a non-boolean `meta`, because `"false"` as a
**string** is not `=== false`, would read as meta, and would silently hide nothing.

**`lootprio.metaOnly`, on by default, and deliberately not in the url** — same reasoning as
`bisSource`: it is a preference about how *you* read the page, and a link you send must not
hide specs from somebody else.

**It is a chip, and it takes the plain accent when pressed.** It began as a quiet outlined
button on the filter row, and that was wrong twice over: `--gold` means *selected* on every
other chip in that strip, so a filter that is on and **not** wearing it read as a button
nobody had pressed — which is the worst possible reading for a control that is on by
default. A filter that is on **is** selected, so no `.chip--toggle`-style override: it uses
the same vocabulary as the class icons beside it. (`BiS only` overrides to epic purple only
because it filters on the BiS tiers, whose colours mean something specific.)

**On the class row, but OUTSIDE `#class-chips`** — that div is `role="group"` with
`aria-label="Class"`, and a control deciding which specs exist is not one of the classes; a
screen reader inside that group would announce it as one. It lives in `#meta-zone`, its own
`flex: none` box on the same row, which also keeps it clear of the strip's `overflow-x`
scrolling. It is not on the spec strip either, even though it governs specs: that row is
`hidden` until a class is picked, and a control you cannot reach cannot be turned off.

**It is rebuilt on every render**, like every other chip, so nothing may hold a reference to
it across an `update()` — a captured node goes stale the moment it is pressed.

**It is the only control here that hides something before being asked**, which is why the
safeguards matter more than the hiding:

- **It never touches rows.** `matches()`, `selectionHas()`, `bisOnlyMatch()` and the search
  haystack all read `effectivePriority()`, the truth — so the item count cannot move, no
  item can vanish from a loot table, and typing `frost` still finds its rows.
- **A `class` entry is never dropped.** A class icon stands for all of its specs; hiding it
  would say something different rather than something shorter.
- **A spec you have selected is never dropped** (`showsSpec()`). Otherwise picking one from
  a `?spec=` link would narrow the table and then show nothing, and there would be no chip
  left to turn the filter off with.
- **The editor never sees it.** `priorityCell()` skips the filter when `canEdit()`, because
  `setOp(list, at, op)`, the drop targets and the `×` all index into the **real** array — a
  filtered copy would edit the wrong entry, or delete something not on screen. Note that
  `startList()` arms edit mode, so a new list or a copy opens already editing and unfiltered.
- **`visiblePriority()` repairs the operators.** The first survivor loses its `op`, since
  the render loop and `validateTemplate()` both refuse one that has it, and `foldOps()`
  collapses the operators spanning a dropped entry: advancing wins, so `Rogue > Enh > Arms`
  stays `Rogue > Arms`, and two holds collapse to `?` rather than to `=` — nobody said those
  two were equal, only that neither was ranked against the thing in between.

**A row whose every ranked spec is hidden goes empty**, and that was chosen with the cost
stated: an empty priority column already means *"this list does not rank this item"*, and on
those rows it means something else. On the shipped list it is **2 rows** in the BiS view and
**none at all** in zatar's, which is why it was judged affordable. If the meta list ever
grows, re-measure — a broader set of 10 put 14 of zatar's rows in that state.

**Seeding honours it too**, so a list started with the toggle on never *contains* the
non-meta lines rather than merely hiding them — which is what stops them reappearing the day
somebody turns it off.
