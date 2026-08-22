# Edit mode — moving the button to the refine bar

Design reference: **5B** in `Loot Prio Redesign.dc.html`. Click the Edit control there before
writing code; the armed/disarmed states are working.

Small change, and independent of both the restyle and `list-menu.md`. Ship it on its own if you
like — it is roughly an hour of work and it is the highest usability-per-line item in the
package.

---

## Why

`#edit-toggle` currently lives in `.template-bar`, at the top of the page. Two problems:

**Distance.** It is ~400px and a whole page-section away from the only thing it affects — the
priority cells. On a 195-item Phase 3 page you scroll past it immediately, and then the control
that changes what you are looking at is off-screen.

**Category.** It sits among list-management controls (switch, rename, copy, delete, share). Those
answer "which list am I working on"; Edit answers "change these calls". Sharing a corner makes
Edit read as list metadata rather than as an action on the content below it.

`.controls--refine` is already `position: sticky` — the bar is on screen at every scroll
position. Putting Edit there means it is never far from whatever row you are looking at, on a
page of any length.

---

## The change

Move `#edit-toggle` out of `.template-bar` and into `.controls--refine`, pushed right with
`margin-left: auto` — after the `ME` class strip and `Reset`.

```
[SLOT All ▾]  [Search…]              [ME ▣▣▣▣▣] [Reset]   Editing — saves as you go  [ Done editing ]
```

Nothing else about the control changes: same id, same handler, same `disabled` rule when the
open list isn't yours, same `title="Make a copy to edit"`. This is a move, not a rewrite.

### Armed state

Three signals, because a destructive-ish mode should be impossible to be in by accident:

1. **The button fills.** `background: var(--fel)`, `color: #0b0d11`, border `var(--fel-bright)`.
   Label goes `Edit priorities` → `Done editing`. This is the one place a fill is right — it is
   a mode, not a selection.
2. **The bar tints.** `.controls--refine` background `#12161d` → `#171d16` and its bottom border
   goes `var(--fel)`. Peripheral, permanent while armed, and it costs no layout.
3. **A status line** appears left of the button: *Editing — changes save as you make them*,
   12px, `var(--fel-bright)`. This is `#edit-msg`'s existing job, so reuse that element and its
   `announce()` calls; it just lives here now instead of in the template bar.

Give the button a `min-width` (118px) so `Edit priorities` and `Done editing` produce identical
geometry. The bar must not reflow when the mode flips — that is the same defect `list-menu.md`
is fixing upstream, and it would be worse here, sitting directly above the rows.

### Rows while armed

Unchanged from what edit mode does today — `+` handles, `×` removers, drag. One addition: give
`.boss-group` rows a `var(--fel)` at 10% wash while armed, so the connection between the bar and
the editable cells is visible without a second look.

---

## What this touches

**`index.html`** — move the `#edit-toggle` button from `.template-bar` into
`.controls--refine`, and `#edit-msg` with it. Both keep their ids and attributes.

**`app.js`** — `bindEditToggle()` keeps its logic; only the element lookup's parent changes. Add
the bar's armed class toggle alongside the existing `document.body.classList` edit-mode flag.
`renderTemplateBar()` no longer renders or hides the toggle.

**`style.css`** — `.controls--refine.is-editing` (tint + border), `#edit-toggle[aria-pressed]`
(fill), `#edit-toggle { min-width: 118px }`, and the row wash.

**Tests** — `test/edit-mode.mjs` queries `#edit-toggle` by id, so most assertions survive the
move unchanged. Check any that assert its ancestor or its position relative to `.template-bar`.
Add one: the refine bar's controls occupy identical geometry armed and disarmed.

**Docs** — `docs/edit-mode-plan.md §1` places the button in the template bar. Update it.

---

## Interaction with the other two files

All three are independent, but they fit together deliberately:

- `list-menu.md` empties the banner down to list *management* (switch, rename, copy, delete).
- This file moves list *content* editing down to the content.
- The restyle is orthogonal to both.

If you ship only this one, `list-menu.md`'s claim that the bar is "exactly two controls" becomes
"exactly one control plus the account zone" — still fixed-width, still no reflow. Nothing breaks.

---

## Considered and rejected

**Per-boss-group Edit buttons** (5A in the prototype). Closest possible proximity, and each
fight arms independently — but it multiplies the control by every group (~13 on a Karazhan
page), and there is no single "I'm done", so there is no reliable way to know you have left edit
mode.

**No button at all — always-editable cells on lists you own** (5C). The nicest to use: hover a
row and the handles are already under your cursor, and nothing can be "in the wrong mode". The
reason it loses is what this app is for. A prio list gets read during a raid, at speed, by
someone who did not write it. Removing the line between reading and authoring means a stray
click changes a call at the worst possible moment. If you ever want it, the right form is
5B **and** 5C combined: arm from the bar, direct manipulation once armed.
