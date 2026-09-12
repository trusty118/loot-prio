# The editing gestures — pointer-only, drag, the add popover, smart filtering, palette

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

### The editing gestures

**The editor is pointer-only, by decision (Aug 2026).**

| Action | How |
|---|---|
| Reorder | drag the icon along its line |
| Remove | the × |
| Operator | click the `>`, pick from the menu |
| Add | `+`, then click an icon — or drag one onto any line |
| Note | click the note, type, click away |

The note is the one editing control that is a **text field**, so typing in it is not an
"editing gesture" in the sense the keyboard ones were and dropping those did not reach it.
Escape abandons, blur commits, Enter is a newline — there is no Save button for it to stand
in for. The field is built on the click rather than always being there: 368 textareas per
render is real cost, and a row you are not editing should read as text. The `↺` beside it
appears only while your wording differs from his.

Every action used to have a keyboard form as well. **Two consequences of dropping them, both
worth knowing rather than rediscovering.** The editor is no longer keyboard operable, which is
an accessibility regression and not merely fewer tests. And **reordering is now drag-only, so
nothing automated covers it** — jsdom can dispatch a keydown but cannot drag, so a reordering
regression will only ever be caught by hand at `localhost:8642`. Remove, operator and add all
kept click paths and are still tested.

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
`setOp(list, at, op)` is the only primitive now; `cycleOp()` went with the keyboard, since
stepping existed only because there is nothing to aim at on a keyboard. The menu and the add popover share
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

**Escape still closes the popover and the menus**, and that is not a leftover: it closes all
five overlays on this page, and is overlay behaviour rather than an editing gesture.

**The repeat rule is enforced in the editor, not just the validator.** `allowsRepeat()` is
the JS port of the rule in `check_priority.py`: a spec may appear twice only when the item
is a `Finger`, `Trinket`, `One-Hand`, `Main-Hand` or `Off-Hand` and is not `unique`. The
editor refuses the drop and says why, so it cannot produce data that fails validation later.

**The palette was restyled to "cold slate", Aug 2026**, from a direction Claude Design
returned against [docs/design-brief.md](docs/design-brief.md). Every neutral cooled to slate so
that **gold and the three item-quality colours are the only warm things on screen** — those are
the colours that carry meaning, and on the old warm browns they were competing with the
furniture. Nothing marked fixed in the brief moved at the time: `--gold`, `--gold-bright`, `--epic`,
`--legendary` and `--artifact` are byte-identical, and the BiS rings were not touched at all.

**The accent has since moved to `#86cf3e`** (bright `#a8e05c`), Aug 2026 — a tempered fel
green, for TBC, and worth recording how it was reached because both ends were wrong. Outland's
own `#8fce00` was the literal answer and read as **acid**: a bright yellow-green is the one hot
thing on a page deliberately cooled to slate, and it appears on every `All` chip at once. Jade
`#2fbf71` corrected the heat and **overshot** — cool and dark enough to look washed out, and no
longer recognisably TBC. `#86cf3e` keeps fel's yellow-green hue, which is the part that reads
as Outland, and takes the brightness out. The tokens keep their `--gold` names on purpose:
renaming 58 usages
buys nothing when a later expansion just changes the two values again. Green is normally wrong
for a WoW page, since `#1eff00` is uncommon quality; it is safe here only because every item in
this dataset is epic or legendary, so **no green item name ever renders**. It also fixed a real
ambiguity — the old `#d9b45a` sat a few degrees from `--artifact #e6cc80`, so "selected" and
"expansion BiS" looked alike despite meaning nothing like each other. **The BiS ladder itself
is still untouched.** Two `rgba()` literals of the old gold (`#spec-chips`, `mark`) were never
tethered to the token and would have stayed gold on a green page; both `color-mix` off
`--gold` now, so they cannot drift again.
The two mute treatments were pushed *harder* (`.35 → .26`, `.25 → .2`) precisely to keep the
brief's promise — slate raises the floor, so the old values had stopped reading as dimmed.

Five things in that package did not survive contact with this repo, and the reasons are all
still live: `.prio-drop-empty` is a transient class on a `<td>` and must never take `display`
(see §5); a rule hiding `.chip-label` had to exempt `.chip--all`; a `.prio-pop-arrow` was
dropped as dead CSS because nothing creates the element; `.field--type` had to be added to the
markup before a rule could hide it; and boss chips needed a `data-tip` they never had, because
the rail hides the name that used to be their label.

A visual-direction brief for handing the look to a designer lives in
[docs/design-brief.md](docs/design-brief.md). It states which colours carry meaning and cannot
move — the epic/legendary/artifact BiS ladder, the accent as "selected", dim as "not you", and the
phase/zone/boss size ranking — so a restyle does not quietly break the semantics. Keep it
current if any of those change.
