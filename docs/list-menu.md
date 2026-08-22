# The list menu — replacing the template bar

Design reference: **4A** in `Loot Prio Redesign.dc.html`. Open it and click through the menu
before writing any code; every behaviour below is working there.

This is the one part of the package that is **not** a restyle. It replaces
`renderTemplateBar()` / `bindTemplateBar()` and supersedes `docs/edit-mode-plan.md §3`.

---

## Why

Three defects, in the order they hurt. All three are visible in the current bar.

**1. The bar reflows.** Signed out on zatar's list it is three controls; open a list you own and
`tpl-name`, `edit-toggle`, `tpl-share` and `tpl-delete` all unhide at once — three controls
become seven. Every button jumps sideways. `New` and `Make a copy` end up somewhere different
depending on state you weren't thinking about, and `#edit-msg` sits *inside* the bar, so its
text length moves them again. (The `.account-zone` comment in `index.html` already identifies
this exact failure mode and solves it for the account button — the same reasoning applies to
everything to its left.)

**2. The name exists twice.** `#tpl-list` shows `My list` and `#tpl-name` shows `My list`, side
by side, with nothing saying which is authoritative. One is a picker, one is an editor, and
they look like a matched pair.

**3. `Delete` → `Sure?` mutates in place.** The confirm appears *under the cursor that just
clicked Delete*, so a double-click destroys a list. `CLAUDE.md:575` records this as a
deliberate choice to avoid `confirm()` — avoiding the browser dialog was right, but arming the
same button was the wrong replacement. It also never says what you lose.

---

## The shape

The bar becomes **exactly two controls plus the account zone, in every state**:

> If you also ship `edit-mode-placement.md`, `Edit` leaves this bar for the refine bar and what
> remains is the trigger plus the account zone. Fixed-width either way — the two changes are
> independent and neither depends on the other landing first.

```
TBC Loot Prio Lists                    LIST [ My list        ▾ ]  [ Edit ]   [ @macka118 ▾ ]
```

Nothing hides. Nothing unhides. Nothing changes width. `New`, `Make a copy`, `Copy link`,
`Rename` and `Delete` move into the menu, where a variable number of items costs nothing.

### The trigger

Reuse `.field--joined` exactly as `#tpl-list` uses it today — `LIST` in `.control-label`,
value beside it, one border around both. It is a `<button aria-haspopup="menu"
aria-expanded>` rather than a `<select>`.

Give the value span a `min-width` (190px) so a short name and a long one produce the same
width.

### Edit

Stays a real button, always visible, `disabled` when the open list isn't yours, with
`title="Make a copy to edit"`.

This replaces `hidden`. A control that vanishes teaches nothing; a disabled one with a reason
teaches the copy path at the exact moment the user went looking for it. `docs/edit-mode-plan.md`
§1 says "there is no Edit button until a list of yours is open" — that is the line this
changes, and it is the only intentional departure from that plan.

**Keep `font-weight` constant across enabled and disabled** and give the button a `min-width`.
Carry the difference on colour and border alone. A weight flip alone moves the row ~1.3px,
which is the same defect class as (1).

---

## The menu

Parent it to `<body>` and anchor it with **`placeUnder()`**, the same helper `.prio-pop` and
`.prio-menu` already use — `docs/edit-mode-plan.md §2` extracted it precisely so overlays
"cannot drift into two versions of the same arithmetic". A third overlay must not reintroduce
that. The `#account` menu is already built this way; match it.

Width 310px. Sections, in order:

| Section | Contents |
|---|---|
| `Your lists` | one row per `store.list()` entry — name, item count, `✓` on the open one |
| `Following` | zatar's list, and anything arrived via `loadSharedTemplate()` — name, `by zatar`, count |
| — | `+ New list` |
| `This list` / `Following <name>` | `Rename…` (owner only), `Make a copy`, `Copy link` |
| — | `Delete list…` (owner only, quiet red, separated by a rule) |

Rows carry the **item count**. That is what confirms you picked the right list, and it is the
same argument `CLAUDE.md §3` makes for keeping counts on the boss chips.

When the open list isn't yours, the actions section opens with a one-line note — *You're
following this list. **Make a copy** to change anything.* — instead of silently offering fewer
buttons.

### Behaviour

- Opens on click, closes on: Escape, `mousedown` anywhere outside, picking a list, or
  completing an action.
- **Exclude the trigger from the outside-close test**, or the document handler and the
  trigger's own toggle both fire and it reopens instantly.
- Escape from `Rename` or `Delete` returns to the menu; Escape from the menu closes it. One
  level at a time — a mistyped rename shouldn't cost the menu.
- Register the listeners in `componentDidMount`-equivalent and **remove them** when the menu
  closes or the bar is rebuilt.
- Switching lists still goes through `validateTemplate()`, exactly as the share path does.

---

## Rename

Replaces `#tpl-name`. The menu panel swaps to a labelled field prefilled with the current name,
`Cancel` / `Save`, Enter saves, Escape returns to the menu.

Saves to `activeTemplate.name` through the same path the input's `blur` used, so the dirty
marker and `store` write are unchanged. Delete `#tpl-name` from `index.html`.

---

## Delete

`Delete list…` opens a **confirm panel in the menu, not a mutated button**. The ellipsis does
its usual job: more is coming.

```
DELETE LIST
Delete "My list" and its 143 items? Anyone you sent the
link to will lose it. This can't be undone.
                                    [ Keep it ]  [ Delete ]
```

Four things matter, and they are the whole point:

1. **The safe button sits where the cursor already is.** `Keep it` lands under the menu row you
   just clicked; `Delete` is off to the right. Double-click-through becomes impossible.
2. **It names what you lose** — the list, its item count, and that shared links break. "Sure?"
   names nothing.
3. **Weight is inverted.** `Keep it` is the solid button; `Delete` is quiet red on a dark fill.
   The dangerous path is the one you have to aim at.
4. **It is undoable.** Delete announces via a toast carrying `Undo`, which restores the list at
   its original index. Keep the deleted record in memory until the toast clears. An undo is
   worth more than any confirm, and with one in place the confirm can stay light.

Remove `deleteArmed` and the `el.tplDelete.textContent = deleteArmed ? "Sure?" : "Delete"` line
(`app.js:2972`).

---

## Status messages

`#edit-msg` currently sits inside the bar, so `Opened My list` and
`Press Delete again to remove "My list"` push the buttons along as they appear and change.

Move it out: a toast pinned bottom-left of the results area, `position: absolute`, affecting no
layout. Keep the `role="status"` element and its `announce()` calls exactly as they are — only
its position and styling change, so the screen-reader behaviour is untouched.

Accent-coloured 3px left border, `#14181f` fill, `1px solid #262d38`. Delete's toast carries the
`Undo` button.

---

## What this touches

**`index.html`** — replace the `.template-bar` contents. `#tpl-list`, `#tpl-name`, `#tpl-new`,
`#tpl-copy`, `#tpl-share`, `#tpl-delete` all go; `#edit-toggle` stays (never `hidden`, now
`disabled`); `#tpl-dirty`, `#tpl-link-out`/`#tpl-link-field` and `.account-zone` are unchanged.
Add the trigger button and an empty `#list-menu` mount.

**`app.js`** — `renderTemplateBar()` and `bindTemplateBar()` are rewritten. Everything below
them is untouched: `newTemplate()`, `newBlankTemplate()`, `encodeTemplate()`/`decodeTemplate()`,
`validateTemplate()`, `loadSharedTemplate()`, the `store` interface, `effectivePriority()` and
all of edit mode. This is a bar rewrite, not a model change.

**`style.css`** — new `.list-menu` block. Reuse `.field--joined`, `.control-label` and the
`.prio-pop` shell values (`#14181f`, `1px solid #262d38`, `0 10px 34px rgba(0,0,0,.7)`) so the
three overlays stay one family.

**Tests — these will fail, and should.** They assert the old bar's mechanics:

- `test/edit-mode.mjs:64` — `tpl-name`/`tpl-delete`/`tpl-share` hidden on zatar's list. Becomes:
  the menu offers no `Rename…` or `Delete list…`, and `edit-toggle` is `disabled`.
- `test/edit-mode.mjs:82` — `!edit-toggle.hidden && !tpl-name.hidden` after Make a copy. Becomes
  `!edit-toggle.disabled`.
- `:296`, `:300`, `:321` — rename through `tpl-name`. Rewrite against the rename panel.
- `:327` — `tpl-delete.textContent === "Sure?"`. Becomes: `Delete list…` opens a confirm naming
  the list, `Keep it` leaves it intact, `Delete` removes it, `Undo` restores it.
- Add: the menu closes on Escape and on an outside `mousedown`; the bar's controls occupy
  identical geometry with a list of yours open and with zatar's open.

**Docs** — `CLAUDE.md` describes the old bar at `:566`, its delete-in-place at `:575`, and the
whole thing again at `:769`; `docs/edit-mode-plan.md §3` specifies it. Update both. §7
(attribution) is unaffected — the menu names the author on every followed list, which is
strictly more attribution than the bar gave.

---

## Order to build it

1. Trigger + menu shell + open/close (Escape, outside click, trigger exclusion). Nothing else.
2. List rows and switching. At this point the old bar can be deleted.
3. New / Make a copy / Copy link — all existing calls, just relocated.
4. Rename panel; remove `#tpl-name`.
5. Delete confirm + toast + Undo; remove `deleteArmed`.
6. Move `#edit-msg` to the toast position.
7. Fix the tests and the two docs.

Steps 1–2 are the whole usability win. If you stop there, the bar is already stable and the
double-click delete is already gone.
