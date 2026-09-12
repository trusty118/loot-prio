# The bar and the list menu

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

### The bar, and the list menu behind it

```
Loot Prio Lists                                                    [ @macka118 ▾ ]

[phase tiles] [zone tiles] [boss rail]
[All][class icons]
[All][spec icons ....][9 items]
──────── sticky from here ────────
                        PRIORITY LIST [ My list ▾ ]  [ Edit priorities ]
[All slots] [All types] [SEARCH____________] [Reset]
```

**The list picker moved out of the banner, and now sits at the right-hand end of the
sticky bar's filter row beside `Edit`, Aug 2026** — see §5. Everything below still holds;
only where the bar lives changed.

**Two controls plus the account zone, in every state. Nothing hides, nothing unhides,
nothing changes width.** That is the whole design, and it replaced a bar that went from
three controls to seven the moment you opened a list of your own — `tpl-name`,
`edit-toggle`, `tpl-share` and `tpl-delete` all unhid at once and every button jumped
sideways. `New`, `Make a copy`, `Copy link`, `Rename` and `Delete` moved into the menu,
where a varying number of items costs nothing.

Three consequences worth keeping:

- **`Edit` is not in the banner at all.** It lives in `.controls--refine`, the sticky panel,
  because it acts on the rows below it — the banner answers *which list am I on*, this answers
  *change these calls*. On a 699-row page the banner scrolls away immediately, taking the
  control that changes what you are looking at with it. Armed, it gives **three signals**: the
  button fills, the bar tints (`.controls--refine.is-editing`), and a fixed-text hint says so.
  A `min-width: 118px` keeps `Edit priorities` and `Done editing` the same width, because this
  bar sits directly above the rows and must not reflow when the mode flips.
- **The hint is fixed text and `#edit-msg` stayed a toast.** The spec asked for `#edit-msg`
  itself to become that status line; it can't, because it carries the delete **Undo** and its
  text varies in length — and variable-length text in this bar is the reflow defect the whole
  redesign has been removing. Two elements, two jobs: constant mode indicator in the bar,
  transient announcements in the toast.
- **`Edit` is `disabled`, never `hidden`**, with `title="Make a copy to edit"`. A control
  that vanishes teaches nothing; a disabled one with a reason teaches the copy path at the
  moment someone went looking for it. Its **font-weight is constant across both states** and
  it has a `min-width`, because a weight flip alone shifts the row about a pixel — the same
  defect the rewrite exists to remove. This overturns `docs/edit-mode-plan.md` §1.
- **The trigger's name span has a fixed `min-width`**, so a short list name and a long one
  produce the same bar.
- **`#edit-msg` left the bar.** Inside it, every message pushed the buttons along as it
  appeared and changed length. It is a fixed-position toast now — same element, same
  `role="status"`, same `announce()` calls, so screen-reader behaviour is untouched.

`savedLists` caches `store.list()`, refreshed by `refreshLists()`, which calls
`renderTemplateBar()` **directly and never `update()`** — `update()` is what calls
`renderTemplateBar` in the first place.

**Rows count what is *ranked*, not what is held.** Every list is a full copy of all 699
records, so an item count is the same number on every row and says nothing — `159 ranked`
for zatar's, `0 ranked` for a list you have just started, is the number that separates
them. `store.list()` returns it as `filled`; `localStore` gets it free from the blob it
already reads, and `remoteStore` pulls `priorities` to count client-side. **If someone
ever has dozens of lists, the fix is a generated column in Postgres, not a lighter
select** — the number has to come from the priorities either way, and the database can
compute it once per write instead of the client computing it once per read.

**The menu is the fourth overlay and shares the other three's machinery**: built once,
parented to `<body>`, positioned by `placeUnder()`, closed by Escape. It has three faces —
the list, the rename field, the delete confirm — swapped in place so there is one anchor and
one Escape target. **Escape backs out one level at a time**: out of rename or delete returns
to the list, and only Escape from the list closes the menu. A mistyped rename should not cost
you the menu.

**The outside-close listens for `mousedown`, not `click`, and that is load-bearing.** A menu
item that swaps the panel has already replaced the menu's contents by the time the click
reaches the document, so the clicked node is no longer a child of the menu and `contains()`
says false — the menu would close itself every time you opened one of its own panels.
`mousedown` fires while the node is still attached. The trigger stops propagation on **both**
halves of the gesture, or its own mousedown closes the menu and its click reopens it.

**Delete is a confirm panel with an undo, not a button that arms itself.** The old bar turned
`Delete` into `Sure?` in place, which put the confirm directly under the cursor that had just
clicked it — a double-click destroyed a list, and "Sure?" named nothing you were losing. Now:
the panel names the list, its item count and that shared links break; **`Keep it` is the solid
button and sits where the cursor already is**, while `Delete` is quiet and off to the right, so
the dangerous path has to be aimed at; and the toast carries **`Undo`**, holding the deleted
record in memory until it clears. An undo is worth more than any confirm, which is what lets
the confirm stay light.

**No browser dialogs anywhere.** Renaming is a panel, opening is the menu, deleting asks in
the menu, and a missing clipboard API reveals the link in a selected field.
`test/edit-mode.mjs` asserts against the source that no `window.prompt` or `window.confirm`
has crept back, and that the bar holds **the same controls whether the open list is yours or
zatar's** — jsdom cannot measure layout, but it can assert the mechanism.
