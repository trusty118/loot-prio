# Known gaps as they stood, and pagination declined

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

## 7. Known gaps

- **Missing items: closed, Aug 2026.** The old "20-30 more" estimate was wrong — it counted
  tier **set pieces** as missing loot. 71 BiS items were sourced to BT or Hyjal and absent
  here, but 62 were Thunderheart/Skyshatter/Lightbringer/Onslaught/Slayer's/Absolution/
  Malefic/Gronnstalker's/Tempest armour, which are what the 15 **tokens** turn into and are
  correctly not listed. The 8 real ones were added. Full audit in `verify/missing-items.md`;
  expect tier armour to keep showing as "not in this dataset" on every `fetch_bis.py` run.
- **Phases 1 and 2 imported, Aug 2026.** Karazhan, Gruul's Lair, Magtheridon's Lair,
  Serpentshrine Cavern and Tempest Keep — 331 rows, taking the dataset from 368 to 699, with
  BiS for all five phases (1,889 entries) and priorities seeded for the new rows. Every chip
  in the expansion now has loot behind it. `Crafted (Nether Vortex)` is the one exception and
  still reads 0: crafted gear is not in the raid loot guides, so it needs its own source.
- **Zul'Aman trash drops are still missing**, which is why that chip reads 0.
- **Still not included:** gems, and Mother Shahraz's shadow-resistance set — intentional
  omissions by the creator — and tier set pieces, per the above.
- **Seeding is computed, not stored data, Aug 2026.** The 268 flat `=` lines that used to
  ship in `loot_data.json` were each exactly the specs `bis.json` lists for that item in
  that phase — a duplicate of data the page already draws as rings. `seedPriorities()`
  computes them into a list of your own at the moment it is created, instead.
  **Interim, and known to be:** it is automatic and unrepeatable, so a list made before a
  `bis.json` correction keeps the old lines, and one made while WoWSims was the selected
  source on Phase 3 arrives empty with nothing offering to fix it. Re-seeding on demand is
  the obvious next move — the primitive already only fills what is empty, so the safety it
  would need is built.
- **`roles` on the imported rows are stats-derived, not BiS-derived.** `fetch_items.py` reads
  them off the item's own stats, which is blunt on hybrids; `verify/seed_roles.py` is the
  better source and has not been re-run since the import.
- **`near` is stored and read by nothing on screen.** It marks the 215 entries a guide
  listed as `Best` past what the slot holds. `check_bis.py` validates it and the client
  excludes it from rings and longevity, so it is not inert — but nothing *shows* those
  alternatives, and showing them is the obvious next use. If nothing does within a phase or
  two it should go rather than accumulate, which is what happened to `BIS_BY_SPEC`.
- **The BiS source toggle shipped, Aug 2026 — with the data behind it incomplete.**
  WoWSims covers P4/P5 only, for 20 of 28 specs, so choosing it on Phase 3 rings nothing.
  The control is honest about that rather than falling back. Filling the gap means
  extending `fetch_bis.py` to pull wowsims presets for all five phases and the 8 missing
  specs; the table in §2 is what to fill.
- **Alias-aware search shipped, Aug 2026** — see §2. 15 of the 44 shorthands used to find
  nothing at all.
- Planned but not built: a rank display for the unused `positions()`. See §3.
- **Keyboard editing and bulk ranking: explained and deferred, Aug 2026.** Worth separating,
  because they were being talked about as one thing and are not. *Keyboard editing* is a
  restoration — `67b0bf3` removed arrows-to-reorder, Delete-to-remove and the icons' tab
  stops, which cost the editor its accessibility **and** left reordering with no automated
  coverage at all, jsdom being unable to drag. *Bulk ranking* is a workflow problem: of the
  268 seeded rows, **96 name a single spec and need no ordering at all**, leaving **172 real
  decisions** — and those fall into only **94 distinct spec-sets**, the commonest 20 covering
  half. The leverage there is reusing one ranking across the rows that share a spec-set, not
  typing instead of dragging. The 272 rows with no priority are a third thing again: they are
  BiS for nobody in the data, so the question is who wants them, not what order.
- **The Role column and filter were deleted, Aug 2026.** The class/spec filter answers the
  same question more precisely. The `role` field stays in `loot_data.json` and in the
  search index (typing "healer" still works), and still tags each row via `data-role`, but
  nothing renders it. "Tier Token" returned to the type dropdown at the same time — the
  Tier role chip had been the only way to reach those 15 items.
- **Clicking a spec icon filters to it, Aug 2026.** The priority line was the content of
  the page and inert: you read "Prot Warrior > Prot Paladin" and then walked to the chip row
  to act on it. Now the icon *is* the control — `focusOn()` sets `state.classes`/`state.specs`
  and everything downstream is the filter that already existed. A spec sets its class too,
  since a spec is never a selection on its own; a class icon picks the class and leaves the
  specs open; clicking what is already the whole selection **clears** it, so an icon is a way
  back out as well as a way in.

  Two things it deliberately does not touch. **The editor never gets it** — there a press
  starts a drag, and an icon that also filtered would fight the gesture it carries; it is
  added in `priorityCell()`, not in `specIcon()`, so the two modes cannot drift into sharing
  it. And a **race icon** is not a control: it carries no registry id, and the spec beside it
  is the thing worth filtering on.

  `BIS_BY_SPEC` was removed in the same change. It was billed here as the natural source for
  this feature and turned out not to be needed — the click reuses the filter, so the answer
  stays one lookup through `bisTier()` instead of a second copy of `bis.json` rebuilt on
  every load and read by nothing.

### Pagination — considered and declined, Aug 2026

**The dataset nearly quadrupled and the per-render cost did not move**, because a phase is
always set: the page renders one phase's zones, never the whole 699. Phase 1 is the largest
at ~200 items, which is about the size Phase 3 was when this was measured. Importing Phases
1 and 2 added rows to the file, not to any single render.

The measurement, from when 195 items were all of them: 17 boss groups, ~2,400 elements under
`#results`. A full `update()` profiled in jsdom at ~180ms median, of which
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
