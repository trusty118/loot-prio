# `specs.json` — identifiers, aliases in search, umbrella specs

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

### `data/specs.json` — the class/spec registry

```json
"specs": { "ProtWarr": { "class": "Warrior", "name": "Protection Warrior",
                         "icon": "ability_warrior_defensivestance", "roles": ["Tank"] } }
```

A spec may also carry **`"meta": false`** — seven do, and the `Meta Specs Only` toggle drops
them from the chip row and both priority columns. Absent means meta. See §3.

Five sections: `classes` (9), `specs` (28 pickable, plus the `FeralDruid` umbrella),
`forms` (Feral bear/cat, each pointing at the spec it resolves to),
`races` (Orc/Human), and `aliases` (the old priority shorthand → id).

`aliases` feeds `verify/migrate_priority.py`, `check_bis.py`'s "did you mean" hint, and
**search, since Aug 2026**. It was loaded and read by nothing before that: the haystack came
from `priorityText()`, which resolves full names, so **15 of the 44 found zero rows** —
`Boomkin`, `SPriest`, `BM`, `Prot Warrior`, `H Pal` among them. The other 29 worked only by
accident, being substrings of the rendered name (`Fury`, `Arms`, `Mage`).

**Adding one is a data edit and nothing else** — a line in `aliases`, and it works. The
smoke test computes which shorthands *should* match from `specs.json` rather than listing
them, so a new one extends the test rather than dating it.

`indexRegistry()` now builds `ALIAS_WORDS`, the reverse index — identifier → the shorthands
for it — **once per registry load, not per keystroke**, because search runs over every row on
every character typed. `priorityText()` appends them.

**Extending `priorityText()` is safe precisely because it is search-only.** It is called from
exactly one place, the haystack in `matches()`; nothing renders it. Words put there cannot
leak into the priority column, which draws icons. If that ever gains a second caller, this
stops being true.

**Forms collapse the way `resolveEntry()` collapses them**, so `Cat` keys `FeralCat` and
finds the rows a cat icon is actually drawn on — not the `FeralDruid` umbrella, which is a
different thing on screen.

**An alias whose target the registry does not know is skipped, never fatal** — `specs.json`
fails soft everywhere else here, and renaming a spec without sweeping the aliases must cost
that one word rather than the page. `test/bis-fallback.mjs` bends three of them and checks
the table still renders and the sound aliases beside them still work.

**A row matched by an alias shows no `<mark>`, and that is not a bug.** `highlight()` marks
the query where it appears in the text on screen, and the whole point of an alias is that the
word is *not* on screen — the column draws icons. So `Boomkin` narrows the table and
highlights nothing. The alternative would be marking the icon the alias stands for, which is
a different feature and arguably belongs to the spec-icon click-through instead.

**An alias matches the thing it resolves to and nothing else.** `Boomkin` does not match a
row whose priority names `Druid` at class level, even though the class/spec *filter* treats a
class as standing for its specs. Search is substring matching over rendered text; teaching it
that hierarchy is a different feature, and the row saying `Druid` already answers to `druid`.

**The key (`ProtWarr`) is the identifier every other data file stores; `name` is display
only.** Renaming a label never touches a data file. Adding a spec is a data edit, not a
code edit — check the icon returns 200 first.

**A spec's `roles` are the kinds of loot it gears for, not what it does in a raid.** That
distinction is load-bearing for smart filtering: `ProtPal` carries `Caster` because spellpower
was its threat stat, `ProtWarr` carries `Physical` for threat weapons, `FeralBear` carries
`Physical` because bears gear from agility leather, and `FeralCat` carries `Tank` because cat and
bear share the same pieces. Fixing these on the **spec** is why almost no item needs a
hand-written exception — the alternative was tagging every caster item `Tank` so a Prot Paladin
could see it.

**Umbrella specs.** A spec with `covers` stands for the specs it names instead of being one
itself. `FeralDruid` covers `FeralBear` and `FeralCat`, because the two gear so differently
that one BiS set can't serve both — Pillar of Ferocity is expansion-long for bear and not
BiS at all for cat. The priorities go on naming `FeralDruid`, so it stays a valid
identifier and no priority was rewritten; it just holds no BiS set and is not offered as a
filter chip. Its icon behaves like a class icon: it rings for whichever covered spec has
the item, and narrows when you pick one. The `forms` entries carry `spec`, so a priority
entry of `FeralDruid` + `form: "cat"` resolves straight to `FeralCat`.
