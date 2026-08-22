# Rework edit mode: a list of your own, not a rewrite of his

> **Status: done, 21 Aug 2026.** Every section is built and the drag was checked by hand in a
> real browser — see the Status section at the foot of this file, which is the part worth
> reading if you are picking this up. Nothing in `data/` was touched by any of it.
>
> Two things this plan did not know when it was written. **Dragging had never worked at all:**
> `specIcon()` built a bare `<img>`, which every browser drags natively, cancelling the pointer
> sequence the editor runs on, and `onDrag` dropped the gesture without a word. That is what
> "dragging is fiddly" in the Context below actually was — and fixing it made **the `.prio-grip`
> handle unnecessary**, so it was dropped rather than built (section 2).

## Context

Edit mode landed on the `edit-mode` branch (commit `97da230`, 378 checks green, unmerged).
The plumbing is sound; the interaction isn't. Reviewing it together, all four of these were
wrong at once:

- **The mental model.** Pressing Edit turns all 195 rows into edit chrome, so it reads as
  "curate zatar's guide" rather than "make my list".
- **Adding is awkward** — a permanent 37-icon palette bar, and you either drag a long way to
  the target row or press `+` on the row and then click an icon.
- **Operators are clumsy** — clicking `>` cycles through all five, so `~=` takes four clicks.
- **Dragging is fiddly** — the whole icon is the drag surface inside a `table-layout: fixed`
  cell, and dragging 14px clear of the line deletes the entry, which fires unintentionally.

**Decisions taken:** a list is still per item (who gets it, in what order). You start it either
**blank** — all 195 rows, every priority empty — or by **making a copy** of a list you're
looking at, the way Office does New / Make a copy. Editing stays **inline in the row**.
Dragging stays but only from a **real handle**. Saved lists get a **small dropdown plus a name
field** on the bar rather than the browser's grey dialogs.

## What is already right, and stays

The model layer in [app.js](app.js) is clean and independent of how the UI looks. None of it
changes:

- `effectivePriority()` / `inTemplate()` / `applyEdit()` / `resetItem()` — the overlay that
  keeps `ALL` exactly as loaded, so zatar's data is never mutated.
- `rejectReason()` / `allowsRepeat()` / `entryKey()` — the editing rules, mirroring
  `verify/check_priority.py`, so the editor cannot produce data the validator would reject.
- `moveEntry()` / `removeEntry()` / `addEntry()` — list surgery.
- `newTemplate()`, `encodeTemplate()` / `decodeTemplate()`, `validateTemplate()`,
  `loadSharedTemplate()`, and the async `store` interface.
- [test/templates.mjs](test/templates.mjs) (14 assertions) — untouched.

## What goes

- `renderPalette()` and the whole palette bar, plus its markup and CSS.
- Drag-out-of-the-row to delete: `overLine()` and the `prio-removing` path.
- The implicit fork — editing while viewing zatar's silently creating a copy.
- Every `window.prompt` / `window.confirm` in the edit paths (`bindTemplateBar`).
- `cycleOp()` — replaced by a direct `setOp(list, at, op)`.

---

## 1. Starting a list — built

Viewing zatar's list is **read-only**. The bar offers `New` and `Make a copy`; there is no Edit
button until a list of yours is open.

> **Superseded, Aug 2026 — see [list-menu.md](list-menu.md).** `Edit` is now always present and
> `disabled` when the open list isn't yours, with `title="Make a copy to edit"`. A control that
> vanishes teaches nothing, and its appearing was itself part of the reflow this replaced.
> `New` and `Make a copy` moved into the list menu. Everything else in this section still holds.

- **New** → `newBlankTemplate()`, a sibling of `newTemplate()` that seeds `priorities[id] = []`
  for every record. All 195 rows still render — same zones, bosses, slots, BiS rings — with an
  empty Priority column and a `+` on each line.
- **Make a copy** → the existing `newTemplate()`, which already deep-copies all 195 priorities.
  Name it `Copy of zatar's list` and set `base`.
- Your own saved lists open **directly editable**; no copy step.

`applyEdit()` loses its `if (!activeTemplate) activeTemplate = newTemplate()` line — a list must
exist before anything can be edited.

## 2. The editing gestures — built

All inline, in the row, only while one of your lists is open.

- **Reorder — drag.** ~~Each entry gets a small `.prio-grip` that is the only drag surface.~~
  **The grip was dropped, and deliberately.** It was prescribed as the fix for "dragging is
  fiddly", but that complaint turned out to be a bug, not a targeting problem: `specIcon()`
  built a bare `<img>`, browsers drag images natively, that fired `pointercancel`, and the drop
  was abandoned silently. With `img.draggable = false` in place the gesture is precise, so a
  grip would only have added a second thing to aim at in a narrow column. `onDrag()`,
  `makeGhost()`, `dropSlot()` and `markSlot()` stay; dropping outside the line returns the entry
  home rather than deleting; arrow keys still reorder.
- **Remove — the `×` only.** One deliberate control, already there.
- **Add — from the row.** A `+` at the end of each line opens a small popover anchored to that
  row: a search field and the class/spec icons grouped by class, built from `REG.classes` /
  `CLASS_SPECS` with `resolveEntry()` + `specIcon()`. Enter picks the first match, Escape
  closes. It runs `rejectReason()` before adding and says why when it refuses.
- **Operator — pick it.** Clicking the operator opens a five-item menu worded with
  `OPERATORS[op].label`, current one marked, so any operator is one click instead of up to
  four. `setOp(list, at, op)` sets it and `cycleOp()` now delegates to that; Enter on the entry
  still steps, because stepping is the right affordance where there is nothing to aim at.
  The menu reuses the popover's anchoring through `placeUnder()` — extracted so the two
  overlays cannot drift into two versions of the same arithmetic — and closes on Escape, on a
  click away, on leaving edit mode and on opening another list.

## 3. The bar — built, then replaced

> **Superseded in full, Aug 2026 — see [list-menu.md](list-menu.md)**, the design Claude Design
> returned against `docs/design-brief.md`. The bar described below had three defects, all of
> them visible: it **reflowed** (three controls became seven when you opened a list of your
> own, and everything jumped sideways); the **name existed twice**, in the select and in the
> field beside it, with nothing saying which was authoritative; and **`Delete` → `Sure?`
> mutated in place**, putting the confirm under the cursor that had just clicked it, so a
> double-click destroyed a list and the question named nothing you were losing.
>
> Avoiding `confirm()` was right; arming the same button was the wrong replacement. It is now a
> confirm panel in the menu that names what is lost, with the safe choice under the cursor and
> an **Undo** in the toast.
>
> Kept below as the record of what was built and why it changed.

Replaces `renderTemplateBar()` / `bindTemplateBar()`. Small, in the page's own styling — no
browser dialogs:

`[ list ▾ ]  [ name______ ]  New   Make a copy   Copy link   Delete`

- **list ▾** — a `<select>` of `store.list()`, plus zatar's list as the first, always-present
  entry. Switching loads through `validateTemplate()` exactly as the share path does.
- **name** — an `<input>` bound to `activeTemplate.name`, saving on blur; replaces the
  prompt.
- **Delete** — two-step in place (`Delete` → `Sure?`), no `confirm()`.
- **Copy link** — unchanged behaviour, but the URL is shown in a copyable field when the
  clipboard API isn't available, rather than a prompt.
- Keeps the dirty marker and the `role="status"` announcements that are already there.

## 4. Consequences to handle, not hide — built

- **A blank list matches no filter.** Every priority is empty, so `selectionHas()` matches
  nobody and the class/spec chips go to zero. That is honest — the filter reflects the list you
  are actually looking at, and it fills in as you do — but the empty state must say so rather
  than looking broken. Do **not** extend `unsourcedBis()` to cover it: that path exists for the
  13 rows the guide never covered, not for your unfinished work.
- **BiS rings still draw**, because they hang off whichever icons are in the line — a blank list
  simply has none yet, and they appear as you add specs.
- **Attribution.** The bar always names what is on screen, and a copy is never labelled as his
  (`base` already records provenance). CLAUDE.md §7 applies: nothing user-made may read as
  zatar's work.

## 5. Tests

[test/edit-mode.mjs](test/edit-mode.mjs) is 25 assertions, most of them about the palette, so it
gets rewritten around the new gestures. The rules assertions survive as they are: reset restores
the guide's order, a unique item refuses the same spec twice, a non-unique ring accepts it.

New coverage:

- `New` gives 195 records with empty priorities; `Make a copy` gives 195 matching zatar's, with
  `base` set.
- Zatar's view renders **no** editable cells and no Edit button.
- The `+` popover opens anchored to its row, filters as you type, adds on click, and refuses a
  duplicate with a readable message.
- The operator menu sets a chosen operator directly, in one click.
- An entry is draggable only by its grip, and a drop outside the line leaves the list unchanged.
- No `window.prompt` or `window.confirm` anywhere in `app.js` — assert against the source, the
  same way the suite already asserts the role sort key exists.

## Verification

```bash
npm test                          # 417 after sections 1, 3 and 4
python3 verify/check_priority.py  # unchanged data
python3 verify/check_bis.py
git diff --stat data/             # MUST be empty - editing never writes the dataset
```

By eye at `http://localhost:8642` (jsdom covers none of the pointer work):

1. On zatar's list: no Edit, only `New` and `Make a copy`.
2. `New` → 195 rows, empty priorities, a `+` on each; the class chips read zero and say why.
3. Add three specs to one row from the `+` popover; reorder by the grip; confirm dragging the
   icon itself does nothing and that dragging clear of the row no longer deletes.
4. Set an operator to `~=` in one click.
5. Name the list, switch away with the dropdown and back — it persists.
6. Copy link, open it in a private window: the list arrives, and a corrupted `#t=` is refused
   with a readable message.

---

## Status — finished and verified, 21 Aug 2026

Every section above is built. **440 checks green**, both validators clean, and
`git diff --stat data/` empty — editing has never written the dataset.

**The drag gesture was checked by hand in a real browser** on 21 Aug 2026, which was the one
thing the suite could not answer for itself: jsdom has no `document.elementFromPoint`, so
`cellUnder()` is unreachable and the tests can only assert that every icon carries
`draggable="false"`. That assertion is the regression guard for the bug below, not proof the
gesture works — so if the drag machinery is touched again, it has to be re-checked by hand at
`http://localhost:8642`: drop into the gap between two icons, onto another row, onto an empty
priority, and well clear of the row (which must return the entry home, not delete it).

### The trap worth remembering

Dragging was broken for this feature's entire life and nobody noticed, because it failed
silently. `specIcon()` built a bare `<img>`; every browser drags an `<img>` natively; that
fires `pointercancel`, which tore down the pointer sequence the editor runs on, and `onDrag`
abandoned the drop without a word. It read as "nothing happened".

Three things keep it fixed, and all three are load-bearing: `img.draggable = false` in
`specIcon()`, `-webkit-user-drag: none` on `.col-prio--editing .prio-edit, .prio-pop-icon`,
and `onDrag()`'s `pointercancel` branch, which now warns rather than vanishing. If a drop ever
does nothing again, check the console for `drag cancelled by the browser, drop abandoned` and
look at those three in that order.
