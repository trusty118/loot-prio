# How the priority column renders — operators and repeats

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

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
| `>` | higher than | next |
| `>>` | much higher than | next |
| `~>` | roughly higher than | next |
| `=` | equal | same |
| `~=` | roughly equal | same |
| `?` | not ranked against | same |

**`?` means nobody has decided.** These names are listed and no order has been put on
them, which is a different claim from `=` ("they are equal") — it is the absence of a
judgement rather than a judgement of sameness. It does not advance a position, because a
rank nobody has decided is not a rank.

It is what the **BiS view** puts between the specs an item is best-in-slot for. That view
used to carry no operators at all, which said "not an ordering" by *absence* and left the
reader to notice; `?` says it out loud and reads the way every other line on the page does.
It is a real operator rather than a display trick, so a line you seeded and have not got to
yet can say the same thing as one the site drew for you — `OP_LIST`, `validateTemplate()`
and `check_priority.py` all accept it, and the operator menu offers it.

`positions()` folds a list into 1-based ranks: `=`, `~=` and `?` hold, the rest advance. `>>`
and `~>` behave exactly like `>` for ranking — they differ only in what they say, which is
what `OPERATORS[op].label` is for (it already feeds the operator tooltips). The comparison
operators read **"higher than"** rather than "better than", Aug 2026: a priority is a
position in a queue, and "better" invites an argument about the item where "higher" states
where it sits.

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
