# TBC Loot Priority Site

A browsable, filterable mirror of a WoW TBC Classic (Tier 6) loot-priority guide,
hosted on GitHub Pages at **https://trusty118.github.io/loot-prio/**.

Vanilla `index.html` + `style.css` + `app.js` reading JSON. **No build step** — that is
deliberate, so Pages can serve the repo root directly. Don't introduce one.

---

## 1. Getting set up on a new machine

```bash
git clone https://github.com/trusty118/loot-prio.git
cd loot-prio
npm install          # jsdom, for the tests only - the site itself has no dependencies
npm test             # 778 checks in ~30s, should be all green
python3 -m http.server 8642 --bind 127.0.0.1   # then open http://localhost:8642
```

Needs `node` and `python3`. `gh` is optional (only used to poll the Pages build).

**On Windows** `python3` is not on PATH — use `py` for both the server and the validators
(`py verify/check_priority.py`). `npm run serve` still assumes `python3`.

**Always view over HTTP**, never by opening `index.html` from disk — the page `fetch`es
its data and will show a load error otherwise.

---

## 2. The data

### `data/loot_data.json` — 699 items, the source of truth

**It holds items, and nothing anybody ranked.** Priorities and notes used to live here,
because zatar's calls *were* the site: `activeTemplate === null` meant "showing zatar" and
everything a template did not hold fell through to `rec.priority`. That made him the
substrate rather than a list, and it made an item a template had never heard of quietly
render his call as if it were yours.

Since Aug 2026 a priority is something a **list** says. His 182 priorities and 177 notes
live in `data/lists/zatar-p3.json`; `unsourced` and `prioritySource` went with them, along
with the 268 SEEDED rows — every one of which was exactly the specs `bis.json` already
lists, so they duplicated data the page draws as rings. **With no list open the priority
column is empty**, which is the honest rendering of "nobody has ranked this".

A handful of `notes` stayed: facts about the **item** rather than anybody's opinion of it —
*"Also drops from Eredar Twins"*, *"Reputation reward from the Scale of the Sands"*. They
show whatever list is open, including none, because they are true either way.

Flat array, grouped in the file by zone then boss in kill order, so a boss's items sit
together for hand-editing.

| Field | Meaning |
|---|---|
| `zone` | `Black Temple`, `Mount Hyjal`, `Crafted (Heart of Darkness)` |
| `boss` | Boss name, `Trash`, or `—` for crafted (rendered as its zone, not as a boss) |
| `item` / `id` / `wowhead` | Name, real TBC item ID, Wowhead link |
| `slot` | `Head` … `Two-Hand`, `Ranged`, `Relic`. Collapsed for display: all weapon slots → `Weapon`, `Ranged`+`Relic` → `Ranged/Relic` |
| `type` | Armour class or weapon type. Displayed with tidy-ups: `2H Staff` → `Staff`, bare `Mace` → `1H Mace` (hand count derived from slot) |
| `roles` | What the item is *for*: any of Physical / Caster / Healer / Tank / Tier, **as a list**. Drives the editor's smart filtering, feeds search, and its first value tags the row as `data-role`. Not rendered — see §6 |
| `notes` | **Facts about the item only** — where else it drops, how it is obtained. Opinions live in a list |
| `unique` | `true` only on the 23 unique items. **Absent means not unique** — see Repeats in §3 |

### `data/lists/` — the lists that ship with the site

`index.json` names them; each file beside it is a template in the shape
`validateTemplate()` already enforces, plus a `phase` and an `author`. Today that is
`zatar-p3.json`. They are **starting points somebody opens and copies**, not a baseline —
nothing falls back to them, and the picker offers only the ones matching the phase on
screen.

**Adding one is a data edit**: drop the file in, add a line to `index.json`. It goes
through `validateTemplate()` exactly as a shared list does — a file that ships with the
site is not more trustworthy than one arriving on a link, just likelier to be right — and
fails soft like `bis.json`, so a bad file costs that option rather than the page.

**An empty priority in a list still means "whoever needs it"**, and 23 of zatar's are
exactly that: he answered, and the answer was nobody in particular. It is a different
thing from an item his list does not mention at all — `[]` versus no key — and
`bisOnlyMatch()` keys on that difference, bridging only the second.

**`roles` replaced the single-valued `role`, Aug 2026.** One word could not say that a plate
piece is wanted by both a Retribution and a Protection Paladin. It was seeded by
`verify/seed_roles.py` from two sources — the specs that call an item BiS in `bis.json` (116
items), and the old `role` for the 79 nothing ranks — then reviewed by hand. `check_priority.py`
enforces that every record carries a non-empty list drawn from the five, and that **no cloth item
is ever tagged `Physical`**, which is what keeps rogues and hunters off robes in the editor.

### `data/specs.json` — the class/spec registry

```json
"specs": { "ProtWarr": { "class": "Warrior", "name": "Protection Warrior",
                         "icon": "ability_warrior_defensivestance", "roles": ["Tank"] } }
```

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

### `data/bis.json` — which items are BiS for which spec

**Two sources, chosen in the bar, and they are not equally complete.** `BIS_SOURCES` in
`app.js` lists them; `indexBis()` builds one index per source and `bisAt()` reads whichever
`state.bisSource` names, so nothing downstream knows there is a choice.

| | P1 | P2 | P3 | P4 | P5 | specs |
|---|---|---|---|---|---|---|
| `specs` (Wowhead) | 283 | 318 | 437 | 460 | 391 | **28 of 28** |
| `wowsimsPresets` | — | — | — | 324 | 335 | **20 of 28** |

Wowhead is the default because it is the only complete one. **WoWSims has nothing before
Phase 4** and is missing `AffliLock`, `DemoLock`, `Disc`, `HolyPal`, `HolyPriest`, `Marks`,
`RestoDruid` and `RestoShaman` entirely — not an import bug, but because `wowsimsPresets`
was captured as `fetch_bis.py`'s longevity cross-check ("does a P3 item survive into the
P4/P5 preset") and only ever needed those two phases. Filling it in means extending that
scraper.

**Choosing a source with nothing to say shows no rings, and does not fall back.** A silent
fallback would make the control a lie about which data you are reading. `custom` is
reserved and holds nothing, so it rings nothing — an entry that quietly did nothing would
read as broken rather than as unbuilt.

**A wowsims entry is a bare item id**, because a preset is the gear a build sims with. It
carries no longevity tier and no qualifier, so every wowsims ring is phase-tier and
unqualified. That is the source's limit, not the import's.

**The choice is a preference, not a filter**: it lives in `localStorage`
(`lootprio.bisSource`) and deliberately **not** in the url, because a link you send should
not change somebody else's source out from under them. `seedFromBis()` reads it too, so
seeding a list from WoWSims and from Wowhead gives different lines.

```json
"ProtWarr": {
  "P3": [ { "id": 32375, "item": "Bulwark of Azzinoth", "bis": "expansion" } ]
}
```

- Keys are the **identifiers** from `data/specs.json` (`ProtWarr`, not
  `Protection Warrior` and not `Prot Warrior`).
- `bis` is optional, defaults to `phase`. Values: `phase` | `multiPhase` | `expansion`.
- Phase keys (`P3`) exist so P4/P5 can be added later without a migration.
- **Run `python3 verify/check_bis.py` after editing.**

**366 entries across all 28 specs, and it is generated** — `python3 verify/fetch_bis.py`
builds it from the sources in `verify/bis-sources.json`, which names one Wowhead Phase 3
guide per spec. Hand edits survive a re-run: an entry already in the file keeps its `bis`
value, and anything the guides no longer corroborate is kept and reported rather than
dropped. Dry run by default, `--write` to apply, `--only <specs>` and `--verbose` while
working on one spec.

Two things the tool will not do, by design. It **never writes `data/loot_data.json`** —
a BiS item this site doesn't list is reported and dropped, never added, because adding
items is a separate job with its own evidence (see §6). And it never edits a `priority`:
those are zatar's calls, and BiS is a layer on top of them.

The rank column in those guides has no fixed vocabulary — 140 rows say `BiS`, but tank
guides rank by purpose (`Best Threat`, `Best Mitigation`) and healers by build
(`Regen BiS`, `BiS - Haste`). `RANKED_BIS`/`NOT_BIS` in the tool encode the rule: lead with
"Best" or name "BiS" anywhere, unless qualified into something else (`Option`,
`Alternative`, `Pre-Raid`, `PvP`, `Best Until Tier 6`). `Near Best` and `Second Best` fail
the leading-word test deliberately.

**`Load BiS data` is a control on the bar, Aug 2026**, beside `Edit`. It fills the **empty**
priorities of the phase on screen from the selected source, joined with `=`, as a starting
point to drag into an order — `seedFromBis()`. It was an item in the list menu, which is to
say nobody found it; sharing left the menu for the same reason, and it lives in one place
rather than two.

**Disabled rather than hidden** when the open list is not yours, with a title saying so —
the rule `Edit` beside it already follows. Two limits make it safe to press: it touches only
the phase on screen, because seeding 699 rows from one click is not something anyone means,
and it skips any row that already has a priority, so **it can only ever add**. Pressing it
twice changes nothing and says so rather than appearing to do nothing.

**With no list open the priority column shows the BiS view**, Aug 2026: every spec an item
is best-in-slot for, in the phase on screen, from the selected source. Without it the whole
of `bis.json` was invisible — rings hang off spec icons in the priority column, and with no
list there were no icons, so 1,889 entries and the `BIS FROM` control had nothing to show
while `bisOnlyMatch()` went on filtering by them. The data could narrow the table and could
not be looked at.

**It must not read as a ranking, and three things keep it honest**: no operators, which is
what makes a priority line an ordering rather than a set; registry order rather than any
order implying preference; and a quiet `BIS` label, without which icons under a column
headed PRIORITY simply read as a priority. `.prio-from` styles it — the class was written
for the old `SEEDED` tag and had been left orphaned.

**Only when NO list is open.** With one open, an item it does not rank stays blank: that is
the list saying nothing, and filling it in would make the list look like it ranks things it
does not. Deliberately narrower than `bisOnlyMatch()`, which bridges the *filter* whenever a
list is silent — a filter that reaches too far shows you an extra row, a display that
reaches too far tells you something untrue.

**A guide lists several rows as `Best` in one slot and ranks them by ROW ORDER.** Wowhead's
Arms Phase 4 two-handers are Cataclysm's Edge, then Soul Cleaver, then Twinblade of the
Phoenix — all three marked `Best`, and only the first is BiS. `fetch_bis.py` used to write
`sorted(entries, key=item name)`, which threw that away, so all three ringed identically.

Entries are now written **in guide order**, and everything past what the slot holds carries
**`near: true`** — 215 of 1,889. Grouped by **(slot, variant)**, which is what keeps the
legitimate cases: a tank's threat helm and mitigation helm are separate groups so both stay
BiS, and so do two rings. `SLOT_CAPACITY` is 2 for `Finger`, `Trinket` and `One-Hand`, 1
otherwise, in both `fetch_bis.py` and `check_bis.py`.

**Near-BiS is not BiS**: no ring, and no claim on how long the item lasted. That second half
matters — a third-choice sword in P4 would otherwise look like the item surviving P4, which
is exactly how Twinblade of the Phoenix came to look like it lasted the expansion.
`check_bis.py` fails if any (spec, phase, slot, variant) group claims more BiS than the slot
can hold, which is the invariant this whole thing exists to enforce.

**How long an item lasts is derived by looking, never taken from a source**, always
**within one source and one spec**. `expansion` means you got it before Sunwell and nothing
in Sunwell replaced it — so the test is whether that source's **last phase still names it**,
not how long a run it had. `multiPhase` outlives its own phase without reaching the end;
everything else is `phase`.

That replaced a run-length rule ("BiS for three or more consecutive phases"), which was a
different claim wearing the same word: an item BiS in P1, P2 and P3 and then dropped is not
BiS for the expansion, and one picked up in P4 and still best in Sunwell is. Cataclysm's
Edge is the worked example — BiS in P3 and P4, replaced by Apolyon in P5, so `multiPhase`.

`longevityOf()` in `app.js` and `tier_from()` in `fetch_bis.py` compute the same thing, and
have to stay in step: the client draws the rings, the stored `bis` field is the record, and
a test asserts the rule reproduces every stored value. A source with only two phases cannot
show `multiPhase` at all — reaching its last phase from its first *is* surviving, as far as
that source can see, which is honest about wowsims holding P4 and P5.

**A variant is not derivable and is read where a source states one.** "Best threat" versus
"best mitigation" is a judgement the guide made, so it comes from the file. wowsims states
none, so its rings carry no qualifier.

---

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

### BiS rings

`data/bis.json` is keyed by the same identifiers and joined on identifier + item id, then
draws a ring on that spec's icon. Colours follow WoW's item-quality ladder, so "rarer"
reads as "lasts longer":

| Tier | Colour |
|---|---|
| Phase BiS | epic purple `#a335ee` |
| Multi-phase BiS | legendary orange `#ff8000` |
| Expansion BiS | artifact gold `#e6cc80` |

**A class icon carries the rings of the specs behind it.** `bis.json` is keyed by spec, but
104 of the 398 priority entries name a *class*, so an item that is BiS for Arcane usually
sits on a row that says `Mage`. `bisMark()` resolves this: a spec icon answers for itself,
and a class icon takes the **highest** tier among its specs. Who the ring is for belongs to
the icon, not the ring, so it goes on the tooltip's **name line** — `Priest — Discipline,
Holy` above a plain `Phase BiS` — and the specs drop the class name the icon already shows.
It matters: of 366 entries, most rings land on a spec icon and around 120 on a class icon.

While a filter is on, only the **selected** specs count toward a class icon's ring, so it
answers "is this BiS for me" rather than "for someone in this class".

A ring still can't appear when the priority names neither the spec nor its class.
`check_bis.py` summarises those as "not visible" — 115 entries across 43 items; pass
`--verbose` for the list. 18 of the items have an empty priority, where there is no icon
to ring at all; the other 25 name other specs.

**That gap is deliberate: never close it by adding specs to `priority`.** zatar is coarser
than per-spec BiS — he never mentions Marksmanship, so items that are MM BiS list only BM
and Survival. `priority` is *his* ordering and is going to be loadable as a template, so
appending the missing spec icons would look like a tidy fix while quietly rewriting the
source guide. Players wanting an MM list will build their own once templates exist.

Every icon carries `data-id` with its registry identifier, so nothing downstream has to
recover it from the display name — forms make that lossy (`Feral Druid (cat)`).

`specs.json` and `bis.json` both **fail soft**: a 404 or malformed file costs the icons or
the rings, not the page.

### Phase, zone, boss

**All three levels are art now, not pills.** Phase, zone and boss all answer "where am I", so
they share one language — art behind, dim until picked — and what separates them is **size**.

**"Dim until picked" is `--art-dim` / `--art-dim-hover`, and every art surface must use them.**
Three separate selectors carry that treatment, and they drifted the first time one was touched:
the rail was lightened for legibility and the two tiles were left behind at `brightness(.45)`,
which is how a shared language quietly becomes two. A test fails on any hard-coded
`grayscale()`/`brightness()` on an art surface. `filter: none` — the *picked* state — stays
literal, because that is the absence of the treatment rather than a variant of it.

The sizes:
a **phase is 148x72** and carries **one strip per raid** (Phase 1 shows three, Phase 3 two); a
**zone is 112x48** and carries its one; a **boss is a 76x44 portrait** in the rail. That ladder
is what says which sits above the other, so keep them ranked if any of them is restyled.
`test/smoke.mjs` asserts the **ordering** rather than the three numbers — the sizes have moved
once already and the ranking is the part that must not.

Those are the **full-width** sizes. Under 1000px the whole ladder steps down (phase and zone go
fluid, the rail portrait returns to 56x34), because the compact set exists to clear a 900px
half-screen window — this page lives beside the game, not alone.

Both tiles carry a scrim (`.chip--phase::after`, `.chip--zone::after`). The phase tile did not
need one at 168x84 and does at 72px: the art is busy exactly where the label lands, and a
text-shadow alone stops carrying it.

**No item count, and no name, on the face of anything carrying art.** The number is noise where
the art is doing the work, and the `N of N items` line above the table already answers it.
Both stay in the `aria-label` — the only way a screen reader gets them — and the boss name is
additionally on `data-tip`, since the rail is the one level whose label is hidden rather than
absent. **This overturns the old rule that boss chips keep their counts**, which was correct
while they were pills with no art competing; once the portrait arrived the number was sitting
on top of the thing it was competing with.

**Bosses were pills until Aug 2026, and the reasoning that changed is worth keeping.** The
argument for pills was that a row of up to 13 has no room to be anything else. That was right
about the row and wrong about the shape: as pills, 13 bosses are 13 borders, 13 gaps and two
wrapped lines; as one bordered rail of portraits with no gaps they are ~786px and fit a 900px
window. `chip()` still builds them — the rail is CSS on `#boss-chips` plus the `.chip-label`
span, not a third builder.

**`chip()` wraps its label in `<span class="chip-label">` so the rail can hide the name.** A
bare text node cannot be hidden, which is the only reason that span exists. The hide is scoped
`:not(.chip--all)`: the leading All cell is a word and nothing else, and hiding its label would
leave an empty clickable box. A test pins that exemption, because it is invisible until someone
looks for the cell that vanished.

`phaseRaids()` is **not** `phaseZones()`. The crafted pseudo-zone has no bosses and no art, so
it gets no strip — having a `BOSS_ORDER` entry is the test, rather than naming it, so a future
crafted-style zone behaves the same way. Its name stays on the tooltip: the phase does cover
it, it just cannot be pictured.

The strips use the same `ui-ej-boss-*` portraits as every other chip, at 128x64. There **is**
sharper art on the CDN — `ui-ej-dungeonbutton-<instance>.png` at 256x128 — and the tiles used
it at first, but there is no instance tile for Serpentshrine or Mount Hyjal, so those phases
could only ever show one of their raids. Representing every raid beat the extra resolution.
(`ui-ej-background-*` and `ui-ej-lorebg-*` are 512x512 and tempting from the filename; they are
parchment textures, not art.)

**The phase is a mode, not a filter.** One is always selected and there is no `All` on that
row: which tier you are gearing for is true for a whole raid tier, where everything else on
the panel is answered per lookup. Clicking the phase you are already on is a no-op, since
deselecting it would leave the page with no phase at all.

`defaultPhase()` is the **last phase that has items**, derived from `ALL` rather than
hardcoded — when Zul'Aman items arrive, Phase 4 becomes the landing phase on its own.
`readUrl()` falls back to it for a missing or unknown `phase=`, and Reset returns to it.

Below that it is still a hierarchy: the zone row is always open (a phase is always set), and
the **boss row waits for a zone**, because every boss of a phase at once is the wall this
exists to avoid. **Leaving a row unanswered means all of it** — a phase with no zone lists
every zone in it, a zone with no boss every boss in it. That needs no "all" state, because
`matches()` simply doesn't apply a filter that isn't set.

**A trade that was chosen, not overlooked:** with the phase locked, a search for an item that
lives in another phase returns nothing and does not say why. Searching across phases, and
marking the empty phases as unavailable, were both offered and declined in favour of the
simpler behaviour. Don't "fix" it without asking. What it *does* say is when a phase is empty
outright — `phaseIsEmpty()` names the phase rather than blaming the filters, which matters
because without an `All` to fall back to an empty phase is the whole page.

Measured while deciding this, for anyone tempted to reach for the phase row to reduce clutter:
at peak there are ~40 controls on screen, and the phase row is 6 of them. The weight is the
boss row (up to 13) and the class row (10).

`PHASES` in `app.js` is the five TBC content phases and the zones each opened, in release
order, and `BOSS_ORDER` now carries the kill order for **all nine raid zones**. Phases 2, 3 and 5
each also carry a **crafted zone**, named for the material it is gated on — `Crafted (Nether
Vortex)`, `Crafted (Heart of Darkness)`, `Crafted (Sunmote)` — all of which render as plain
`Crafted`, since no two are ever on screen together. They have no bosses and no `BOSS_ORDER` entry, which is
exactly what keeps them off the phase tile's art strips. **Only Phase 3 has
items**: everything else is chips reading `0`, so the shape of the expansion is visible and an
item has a boss to arrive under. `ZONE_ORDER` is derived from `PHASES`, which keeps
`bossSortKey()` working without a second list to keep in step.

`Trash` is listed only for the raids that actually drop it — Karazhan, Serpentshrine, Tempest
Keep, Zul'Aman, Sunwell, and the two Phase 3 raids. Gruul's Lair and Magtheridon's Lair have
none, which is why they have no chip for it.

Every portrait was checked for a 200 before being wired, and the slugs are as irregular as the
existing ones warn: `alar`, `akilzon`, `janalai` and `kiljaeden` drop their apostrophes,
`the-curator` and `the-lurker-below` keep their article where `illidari-council` does not, the
Opera Event is plain `opera`, and Zul'jin is filed under `daakara`. **The Chess Event has no
portrait in the journal at all** — its chip falls back to text, which `chip()` handles.

Picking a different phase clears the zone and boss under it — they belonged to the phase you
left — and `readUrl()` drops a `zone=` that isn't in the `phase=` it arrives with, so a stale
link narrows to nothing instead of showing a zone the row can't display.

One consequence for `bossZone`: only one zone's bosses are ever on screen now, so the two
`Trash` chips can no longer be confused visually. The state still needs to tell them apart —
a shared `#boss=Trash` link is still ambiguous — so none of that machinery went away.

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

### URL state

Filters live in the hash: `zone`, `boss`, `bossZone`, `class`, `spec`, `bis`, `role`,
`type`, `slot`, `q`, `sort`. `class` and `spec` are comma-joined lists, checked against the
registry on read, so a stale identifier is dropped rather than filtering every row away.

`bossZone` exists because boss names are **not unique across zones** — both raids have a
`Trash`. Boss chips are identified by zone + boss, and it is written only when the name is
ambiguous, so the other 14 bosses keep the short URL they have always had. An old bare
`boss=Trash` link carries no `bossZone` and keeps its original both-zones behaviour.

## 4. Edit mode — your own priority list

> **Reworked and finished, Aug 2026.** [docs/edit-mode-plan.md](docs/edit-mode-plan.md) records
> what changed and why, including two decisions that are easy to undo by accident: the
> `.prio-grip` handle was **dropped** once the real drag bug was found, and the drag itself is
> **only ever verified by hand** — jsdom cannot reach the gesture, so a green suite says nothing
> about it. Re-check by hand if you touch the drag machinery.

The whole data restructure was aimed at this. `priority` became an ordered list of
`{spec|class, op}` entries so a person could reorder icons and pick operators.

**zatar's data is never mutated.** `ALL` stays exactly as loaded, so "back to his order"
is always one click away and a template can be diffed against the original. Edits live in
an overlay:

```js
function effectivePriority(rec) {                       // the template's, else the guide's
  return (activeTemplate && activeTemplate.priorities[rec.id]) || rec.priority;
}
```

**Everything that asks what a row says goes through that**, never `rec.priority`: both
priority cells, `selectionHas()`/`priorityHas()` behind the class/spec filter, and the
search haystack. Two deliberate exceptions read `rec.priority` precisely because they want
the original — the reset button, and whether to offer one.

**`effectiveNotes()` is the same overlay for the notes column, added Aug 2026**, and the
same rule applies: the cell reads it, and so does the **search haystack** — otherwise a
search keeps finding wording you have already replaced, which is the bug the priority
haystack was already written to avoid.

Notes are yours on exactly the terms the priorities are. `copyOfCurrent()` seeds
`template.notes` from `effectiveNotes(rec)` for all 368 records, you edit them, and
`base: "zatar"` records where they came from — there is no new attribution question,
because it is the one the priorities already answered. `newBlankTemplate()` deliberately
does **not** seed them: you asked for nobody's list, and his wording is somebody's.

**Notes did not reach the database for their first weeks, and the shape of that bug is
worth keeping.** `remoteStore.save()`'s upsert never named a `notes` column, so a signed-in
edit saved, appeared to work, and was gone on the next load — while working perfectly signed
**out**, where `localStore` writes the whole blob. Nothing errored: an upsert silently drops
what it does not mention. Every `?s=` recipient read the guide's notes rather than the
sharer's, because `get_shared_list` did not select the column either.

Three defences now, because one was clearly not enough. `test/auth.mjs` edits a note through
the table and asserts it reached the account; it asserts a `?s=` recipient reads it; and the
**fake Supabase projects the columns `get_shared_list` declares** rather than handing back
whole rows, with `RPC_COLUMNS` pinned against `verify/notes-and-author.sql`. A fake that
returns the whole row cannot reproduce a missing-column bug at all — which is exactly why
the original shipped green. **Any new field on a template needs all three: the upsert, the
SQL, and `rowToTemplate()`.**

**`notes` is optional and `TEMPLATE_VERSION` did not move.** Absent means "the guide's", so
every list saved before this and every share link already sent still opens. `validateTemplate()`
refuses a `notes` that is present and wrong — not an object, a value that is not a string, or
one longer than `MAX_NOTE` (600), which is also the textarea's `maxLength` so a list of your
own can never be one your own validator would refuse when it comes back off a link.

### Whose list is on screen

Three views, one variable and one flag:

```js
var activeTemplate = null;   // the list being VIEWED; null means zatar's
var activeIsMine = false;    // is it in your store? false for one from a #t= link
```

**zatar's list is read-only reference, and so is a list that arrived on a link.** Only a
list in your own store is a workspace — `canEdit()` is `activeTemplate && activeIsMine &&
state.editing`, and it is what `renderRow` and `renderPalette` gate on. You get one of your
own two ways, the way Office does it:

- **New** → `newBlankTemplate()`, all 699 rows with every priority empty, `base: "blank"`.
- **Make a copy** → `copyOfCurrent()`, which deep-copies `effectivePriority(rec)` for every
  record. That one function copies the guide's list, one of yours, or a shared one, without
  branching on which — and it is the only way to keep someone else's link.

`state.editing` survives as an **Edit / Done** toggle, but only appears once a list of yours
is open: a finished list gets read during a raid, and it should not be covered in `×`s. It is
cleared by every view change (`openTemplate()` is the single place that happens).

**A row is reachable through its BiS only while reading a list that is not yours.** That path
bridges a gap in *his* data; with a list of your own open there is no gap, and letting 13
rows through a filter the other 182 fail would make your own list lie about itself.

### What a template is

```json
{ "id": "t_9f3c", "name": "MM hunter list", "created": "2026-08-20",
  "v": 1, "base": "zatar", "priorities": { "32375": [ { "spec": "ProtWarr" } ] } }
```

A **full copy** of all 699 priorities, not a diff — **~4,700 characters** gzipped and
base64url'd. It grows with the dataset, and stays workable because it rides in the
**hash**: a fragment never reaches a server, so there is no request-line limit to hit and
the only ceiling is the address bar. The `?s=` path pays none of this — a token is ~30
characters whatever the list holds. Two consequences, both handled
rather than hidden:

- **It is frozen.** Later corrections to `loot_data.json` don't reach a saved template;
  `base` and the date are stored so the UI can say so.
- **Items added later aren't in it.** Anything missing renders from `loot_data.json` and is
  marked as not part of this template, never silently blank (`inTemplate()`).

A **blank list is a template like any other** — it validates, saves and shares; an empty
priority is valid data, not a broken one. Its consequence is that it matches no class or spec
filter, so the chips all read zero. That is honest, and `blankListFiltered()` makes the empty
results say so rather than look broken. **Don't paper over it by extending `bisOnlyMatch()`.**

### Storage

```js
var store = { list(), load(id), save(t), remove(id) };   // localStore or remoteStore
```

**Async from the start** even though localStorage is synchronous, so the remote
implementation would be a drop-in rather than a refactor of every call site. That is the
entire reason edit mode was built before login — **and it paid off exactly as intended**:
adding Supabase changed `activeStore()` and nothing else. No call site moved.

**Signed out is the whole product.** Make lists, edit them, share them by link, all kept in
`localStorage`. Signing in is an *upgrade* — your lists follow you between machines instead
of being trapped in one browser — and never a gate. Friends arriving to try the editor must
never meet a login wall, which is why `activeStore()` falls back rather than refusing.

**Sign-in uses the PKCE flow, and that is not a detail.** The implicit flow returns the
session in the **hash fragment**, which is where this entire site keeps its state — the two
would be writing to the same place on the same page load. PKCE returns `?code=` in the query
instead. Different storage, no collision.

**`writeUrl()` must preserve `location.search`.** It used to rebuild from `location.pathname`
alone, silently dropping any query string. Nothing here uses the query string, so it went
unnoticed for the life of the project — until an OAuth redirect came back as `?code=` and
`update()` deleted Discord's answer at boot, *before the SDK had finished loading*. Sign-in
then did nothing at all, with no error anywhere.

**The hash cannot ride along in `redirectTo`.** Supabase appends `?code=` to that URL, and a
query has to sit before a fragment, so a `redirectTo` ending in one composes into nonsense.
`stashReturn()` parks the hash in `sessionStorage` and `restoreReturn()` puts it back once the
session lands — which is why signing in returns you to the phase and filters you left.

**The SDK is very often not loaded when `initAuth()` first runs**, and it looks like it
should be. `app.js` is a classic script at the end of `<body>` so it executes *during*
parsing; the deferred SDK executes *after*. `app.js` is therefore always first, and
`initAuth()` is called from the data-fetch `.then()`, which over localhost resolves in a
couple of milliseconds — long before 212KB arrives from a CDN. Checking `window.supabase`
once and giving up meant **the button never appeared at all, on exactly the machine you
would be testing on**. `whenSupabaseReady()` waits on the `<script id="supabase-sdk">`
tag's `load` event instead, and checks the global *first* — if the script has already run,
its `load` has already fired and will never fire again.

**Everything about sign-in fails soft**, the same way `specs.json` and `bis.json` do: no
config, a blocked CDN, a paused project, or jsdom — you lose sign-in, not the page. That is
why `supabaseReady()` is re-checked at each entry point instead of being resolved once, and
why the sign-in button is *absent* rather than disabled when it could not work. A disabled
button says "this is broken"; no button says "this site has no accounts", which is the
truth in that state.

**The anon key belongs in `app.js` and is not a secret.** It identifies the project; it
authorises nothing. What actually protects a list is the row-level-security policy
(`auth.uid() = user_id`) — the database itself refuses to hand over someone else's rows no
matter what the client asks for. **The service-role key bypasses those policies and must
never appear in this repo**; `test/auth.mjs` greps for it, and for any pasted JWT literal,
with comments stripped first so the file can still explain the rule without failing on it.

**The two stores are simply separate, and that is deliberate.** A list made signed out lives
in `localStorage`; a list made signed in lives in the account. Signing in swaps which one the
dropdown reads, so local lists stop appearing — they are not deleted, and signing out shows
them again.

**There is no "copy my local lists into my account" offer, and one was built and removed.**
It appeared on the bar when the account was empty and this browser had lists. Two things were
wrong with it: it was an offer with no way to decline, so it sat there until pressed, on a bar
that was already too busy; and it existed to solve a problem nobody actually has, since the
lists are one sign-out away and nothing is lost. **Don't rebuild it** — if the disappearing
lists ever genuinely confuse someone, the fix is to say so in words, not to add a button.

**There is no Save button.** A list is written when it is made and again on every edit
(`saveNow()`), so it is in the dropdown from birth and nothing is lost by forgetting to press
something.

**A save cannot clobber someone else's, Aug 2026.** The whole row travels on every write —
~21 KB of priorities and notes — so before this, two people editing one list meant the second
save sent its ten-minute-old copy over the top of the first one's work. No error, nothing on
screen, found out days later if at all. It is the same silent-write shape as the `notes` bug
below. `rowToTemplate()` now carries `updated_at`, and the save is
`.update(...).eq("id", …).eq("updated_at", …)` — **zero rows back is not an error from
Postgres, it is the answer**, and it means somebody else wrote first. `saveNow()` says so and
offers **Reload**, and deliberately leaves `unsaved` true: the edit is still on screen and
still unsaved, and saying otherwise is the lie the guard exists to stop telling.

**`localStore` is not guarded, and the gap is real rather than hidden**: one browser is one
writer, but two *tabs* of it are two, and there the last save still wins in silence. The name field is the one thing debounced, at 400 ms, because it fires per
character. Whether a write is outstanding lives in a module-level `unsaved`, deliberately
**not** on the template — so scratch state never travels into the store or into a share link.

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

### Sharing by link

**Sharing has its own control and its own popover, Aug 2026 — nothing about it is in the
list menu.** It used to be an item four deep in that dropdown, which is to say nobody found
it. `#share-trigger` sits in `.list-zone` between the picker and `Edit`: *which list · give
it to someone · change it.* Icon-only, name on `data-tip` and `aria-label`.

**The item it replaced was dead in the state most people meet first.** `copyShareLink()`
opened `if (!activeTemplate) return;`, so on zatar's list the menu offered `Copy link`, you
pressed it, and **nothing happened** — no clipboard write, no message, no error. That is the
first share control anyone sees, since it is what you get before making a list of your own,
and it passed 739 checks. `test/smoke.mjs` now pins that a link comes out **in every state
the control is offered in**, which is the assertion that was missing.

**The popover is the seventh overlay** and is built like the other six: created once,
parented to `<body>`, positioned by `placeUnder()`, closed by Escape and by an outside
`mousedown`. Two faces, swapped in place the way the list menu swaps rename and delete:

- **publish** — a list of yours, signed in, not shared yet. Says what publishing does, and
  offers a button. This face exists so that *opening* the popover never publishes: looking
  at a thing must not change it. It is the same instinct that named the old menu item
  `Share this list…` rather than `Copy link` — a label, or a panel, that hides a side effect
  is a bad one.
- **link** — the URL in a read-only field, selected on open, with **Copy** beside it and
  `Stop sharing` beneath where there is something to stop. Everything else opens straight
  onto this: signed out, zatar's list, or an already-shared list has nothing to publish.

**`Stop sharing` moved here from the menu**, next to the link it stops rather than next to
Delete.

**On zatar's list the link is the current page URL, hash and all** — `location.hash` already
carries phase, zone, boss, class, spec and the search, so *here is what I am looking at* is
a real thing to send, and it is what the dead item was pretending to do.

**`offerLink()` and `#tpl-link-out` are gone.** That hidden field existed only to reveal the
link by hand when the clipboard API refused — which is exactly what the popover now is,
permanently. Removing it also removed one of the three `[hidden]`-versus-`display` traps §5
records.

**The popover's buttons wear the accent and the trigger does not**, which is not a
contradiction. Green means *selected* **on the page, among things you can select** — so the
trigger, sitting on the bar among chips, stays quiet slate. Inside an overlay there is
nothing selectable and the accent reads as "this is the button", the same licence
`.prio-add` takes when the `+` is the only thing to do in an empty cell.

**Two paths, chosen by whether you are signed in, and they mean different things.**

**Signed in → `?s=<token>`.** It carries a token, not the list, so it is ~30 characters
however much the list holds — which is what makes unbounded notes possible at all.
`Stop sharing` clears the flag and the link stops resolving; so does deleting the list.

#### Draft and published, Aug 2026

**The link used to be live**, serving the row as it stood that instant — so officers
reshuffling at 8pm were doing it on everyone's screen. A list now has two faces: the
**draft** its owner edits, and the **published snapshot** the link hands out. They meet only
when someone presses Publish (`publishNow()`), and `get_shared_list` returns the
`published_*` columns.

**The URL never changes, and that is the whole point of it being a token.** The link points
at the row; the row decides which version to serve. One URL, pinned in Discord once, serving
whatever was last published — so publishing is never "send everyone a new link".

**Publish is a plain owner-authenticated `update` under `auth.uid() = user_id`. It must
never become a security-definer function taking a share token** — that would let anyone
holding the read link publish over the draft, and it is the one way this feature can be got
badly wrong. Reads go through the narrow definer function; writes only ever happen as the
owner. `verify/draft-publish.sql` says so at the bottom, where someone adding a "publish by
link" feature would be looking.

`published_at is not null` is the other half of the read condition, and it is what "locked
until we are happy" means: a list nobody has published resolves to nothing rather than
leaking the draft. `shared` is untouched and still the link's on/off switch — the two
answer different questions, *is there a link* and *what does it serve*.

**The migration backfills, and that is not optional.** Every already-shared list has no
snapshot, so switching the function over without seeding one would make every link in
circulation return a list with no priorities — which reads as data loss, because that is what
it looks like. `verify/draft-publish.sql` copies the live columns into the published ones for
exactly those rows first.

`changedSincePublish()` counts items, not keystrokes, because *"23 items have changed"* is
the number a loot council can act on. It is what the share panel offers `Publish changes` on.

**`renderShareLinkFace()` carries a render token (`shareRender`).** `shareLink()` is async and
the face is rebuilt whenever it is reopened or republished, so without it an earlier call
resolving late writes its url into a field that has already been thrown away — and the panel
on screen stays on "Preparing…" for good.

**Signed out, none of this appears**, and nothing is lost by that: a `#t=` link *is* the list,
frozen the moment it is copied, so copying the link already was publishing.

**The token is never the list id.** Ids are `t_9f3c` — four hex characters — so a link built
from one could be guessed by trying ids until something came back. `makeShareToken()` is 128
bits from `crypto.getRandomValues`.

**Anonymous reads go through a `security definer` function, not a relaxed policy.** The
obvious `using (shared = true)` would let anyone select **every shared list on the site** in
one query; shared lists should be readable by people who have the link, not enumerable by
people who do not. `get_shared_list(token)` can only return a row that is both flagged
`shared` and matched by an exact token, and the `lists` table itself stays unreadable to
anonymous callers. `docs/sharing-setup.md` has the SQL and the two curl checks that prove it.

**The recipient needs no account, and that is the point.** `supabaseReady()` checks
`sb && supabaseConfigured()`, deliberately **not** `signedIn()`, and the SQL grants
`execute` on `get_shared_list` to `anon` as well as `authenticated`. Most people who open
a shared link will never sign in — it is the primary path through the feature, so
`test/auth.mjs` exercises it on a window that never calls `_signIn()`. It also asserts the
recipient side honours `Stop sharing`: a token whose row is no longer flagged opens
nothing. Without that, the button would be a lie told only to the sharer.

**Shared links depend on the Supabase project being awake.** The free tier pauses after
~a week idle (see `docs/sharing-setup.md`), and a paused project fails as a transport
error rather than an empty answer — which is why the two cases say different things.

**A shared link that cannot be resolved says so; losing sign-in does not.** `whenSupabaseReady()`
takes a failure callback for exactly this. The absent sign-in button already communicates
"no accounts here", but a visitor who followed a link to one specific list would otherwise be
looking at a different list with nothing to explain the swap. The page still renders behind
the message: it costs the shared list, not the site.

**Signed out → `#t=`, exactly as before.** There is nothing in a database to point at, and
the site has to keep working without one. That link is frozen and size-capped, which is the
honest trade.

**A `?s=` link cannot be read at boot** — the SDK is still arriving. `loadSharedTemplate()`
reports it as handled and `initAuth()`'s `getSession()` is where it actually resolves. Same
shape as the sign-in race, for the same reason.

### The `#t=` encoding

`encodeTemplate` / `decodeTemplate` gzip via `CompressionStream` and base64url into `#t=`.
The `z` prefix marks gzip, `r` raw base64 for browsers without it. In the **hash fragment**
it never reaches a server.

A template from a link is **untrusted input**. `validateTemplate` enforces the same rules as
`verify/check_priority.py` — identifiers resolve, operators are among the five, the first
entry has no `op`, no illegal repeats — and refuses with a readable message rather than
rendering a broken table. `test/templates.mjs` hand-crafts one violation of each.

It opens as **reference, not as yours**: the dropdown says `Shared: <name>`, nothing of theirs
is written to your store, and Make a copy is how you keep it.

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

## 5. Conventions that are easy to break

- **Never use a bare element selector in `style.css`.** Wowhead's tooltip script injects
  its own DOM into the page. A bare `table { min-width: 940px }` once matched their
  tooltip tables and pinned every item tooltip to 940px wide — and `min-width` beats
  `width` and `max-width`, so no override could fix it. Scope to `.boss-group table`.
- **A `display` rule beats the browser's `[hidden]`.** It has bitten twice: once on
  `.control-row`, once on `.tpl-link-out`, where it left the share-link box permanently on
  the bar. Anything the code hides with `hidden` must either never set `display`, or pair it
  with the attribute — `.x[hidden] { display: none }` or `.x:not([hidden]) { display: flex }`.
  `test/smoke.mjs` checks this against the stylesheet **source**: jsdom does not load external
  CSS, so a `getComputedStyle` check would pass no matter what the rule said. **It has now
  bitten three times** — `.control-row`, `.tpl-link-out`, and `.btn-discord`, which would
  have pinned the sign-in button to the bar whether or not you were signed in. The third one
  also exposed that the guard was scoped to `main [hidden]`, so it never covered the template
  bar — which was in `<header>` at the time, and is where all three actually happened. It is
  document-wide now, and stays that way even though the bar has since moved into
  `.controls--refine`. A guard that does not cover the scene of the crime is not a guard.
  (`.tpl-link-out` no longer exists — the share popover replaced what it was for — but it is
  named here because the lesson is about the rule, not the element.)
- **Don't hide table cells with `display: none`.** The tables are `table-layout: fixed`;
  hiding a cell makes the rest shift into the wrong columns. Don't generate the column —
  that is how the Role column was removed.
- **`title` attributes have a ~1s browser delay** that can't be configured. Icon tooltips
  use `data-tip` plus a `.tip` element parented to `<body>` (inside the table it would be
  clipped by the scroll container).
- **The three data fetches revalidate (`FRESH = { cache: "no-cache" }`).** Pages serves
  these with `max-age=600`, so without it a corrected role or boss attribution reads stale
  for ten minutes after a deploy — the "everyone hard-refresh" problem, which nobody should
  ever be asked to do. `no-cache` does not disable caching; it forces a conditional request,
  which costs a ~200-byte `304` when nothing changed. This is also **why item data stays in
  files rather than moving to a database**: code and data ship in one commit and deploy
  together, so a cached `app.js` can never disagree with the data it is reading. A database
  reintroduces exactly that skew.
- **Icon URLs are verified before use.** Everything comes from `wow.zamimg.com`; check a
  new one returns 200 before wiring it up. Boss portraits are Encounter Journal art
  (`ui-ej-boss-*.png`) with irregular slugs — `najentus`, `kazrogal`, no leading "the" on
  the Illidari Council.
- **Slot and Type are drawn by the page, not by the OS.** A native `<select>`'s popup is
  rendered by the operating system — its background, highlight and font are unreachable from
  CSS — so those two were the only controls on the page still looking like macOS. The
  `<select>` **stays and is still the source of truth**: `fillSelect()` rebuilds it, `app.js`
  reads it, the URL drives it and the tests set `.value` on it. The menu is a skin, and the
  native control is hidden **only once its trigger has been built**, so an enhancement that
  fails to construct leaves a working select rather than nothing. Arrow keys, Home/End, Enter
  and Escape all had to be written by hand — that is what a native select gives away for free
  and what replacing one costs.
- **The list controls live in the banner; the refine bar is filters only, Aug 2026.** The
  pinned bar had eleven things on it, and the test for a place there is not *"is this a
  filter"* but **"do I reach for this while scrolling 699 rows"**. The picker fails it:
  which list is open is something you need to **know** constantly and **change** rarely.

  **This reverses the earlier move, and what makes it viable is the count line.** It now
  reads `195 of 195 items · My list` — so the bar that *does* stay on screen still says
  which list you are reading. That was the thing missing when the picker was moved out.
  The separator is a text node, not a CSS `::before`: the line is `aria-live`, and a
  generated separator has it read "195 of 195 itemsMy list".

  **`#edit-toggle` went with it, and `#edit-pill` is what pays for that** — fixed,
  bottom-right, present only while armed. The banner scrolls away, so without it there is
  no way out of edit mode from four hundred rows down. A control that appears *for* a mode
  is expected; it is not the reflow defect this section warns about.

  **The class and spec strips moved the other way, into the sticky panel.** They were at
  the foot of the where-hierarchy, which read well and cost the thing that matters more:
  they are filters you adjust *while reading rows*. Two rows at rest, three while narrowing
  to specs — it pays a row exactly when you are using it, and never a fourth.

  **The spec strip scrolls; it must not squash.** Three rules agree and the failure is
  invisible: without `flex: none` on the icons, flex shrinks them below 26px and the strip
  *looks* like it fits. `overflow-x: auto` gives it somewhere to go, and `flex-wrap: nowrap`
  is required because flex prefers a new line to a shrunk item — a wrapping row takes a
  fourth line instead of ever scrolling. All three pinned against the stylesheet source,
  since jsdom lays nothing out.

  **Spec chips group by class**, one `.spec-group` each, with the divider on
  `+ .spec-group` so the **first has none** — a rule before the first group divides nothing
  and pushes the strip out of line with the class strip above.

- **`BiS from` lives in the account menu, which is always present.** It is the page's one
  true setting: per-browser, out of the url, set about once. Each option carries what it
  costs — *Wowhead, all 28 specs, every phase* against *WoWSims presets, 20 specs, Phase 4–5
  only* — because the sources are wildly asymmetric and the bare `<select>` never said so,
  which is why choosing WoWSims on a Phase 3 page read as broken rather than empty.

  **The menu is not tied to auth**, and that is the part worth keeping. Signed in it is the
  account button; otherwise it says `Settings` and holds the source alone. The account zone
  is empty when Supabase is unreachable — `show(el.signIn, supabaseReady() && !signedIn())`
  — so a preference living only behind a login would have nowhere to go for exactly the
  people §4 says the site is for. `Sign in with Discord` stays a button on the bar as well:
  that is the call to action, and burying it would make the upgrade harder to find than the
  setting.

- **Two control panels**: `.controls--where` (phase → zone → boss) and `.controls--refine` —
  everything that narrows the table, which is type, slot, search **and who you are**. Class
  and spec used to have a panel of their own at the top; they are filters, so they belong
  with the filters. **Which panel** is the rule; which row of it is not, and the row moved.

  **The strips sit on a row of their own inside that panel (`.control-row--who`), anchored
  left, Aug 2026.** They spent a while beside the search box, which was fine at nine class
  icons and fell apart at twenty-eight spec icons. `.who-inline` was right-aligned, so the
  spec strip grew **leftward** — ~935px of it, sprawling under Slot, Type and Search — and
  once it was that wide it no longer fitted beside the search box, so `.control-row--inputs`
  wrapped it onto a second line and took Reset and Edit down with it. The class strip ended
  up floating mid-row, attached to nothing.

  On its own row the two strips share a left edge, the spec strip grows **rightward**, and
  it has the whole panel to grow into: all 28 specs fit on one line at desktop width and it
  wraps within its own row below ~1000px. The class strip never moves, whatever is picked
  under it. Three rules carry that and `test/smoke.mjs` pins all three against the
  stylesheet source, because jsdom lays nothing out: `.who-inline` is a **column**, it is
  **`align-items: flex-start`**, and it has **no `margin-left: auto`** — that last one is
  what made it grow the wrong way.

  **`#edit-toggle` carries its own `margin-left: auto`**, which is why Edit stayed at the
  right-hand end when the who block left the row. Don't move it onto a neighbour.

  `.field--grow` still caps the search box at 300px, but no longer to make room for icons
  beside it — there are none now. It stays capped on its own merits: you type in it
  occasionally and never read from it.
- **The class and spec strips are the last row of `.controls--where`; the list picker and
  `Edit` sit at the right-hand end of `.controls--refine`'s filter row, Aug 2026.** The
  strips read as the end of one sequence — *which phase, which zone, which boss, who for* —
  rather than as another filter among the dropdowns.

  **The picker had a row to itself until Aug 2026, and the reason it lost it is the shape
  of the whole bar rather than anything wrong with the picker.** `.list-zone` carries
  `margin-left: auto`, so on its own row it left ~700px of empty bar to its left while the
  filters packed hard against the left below it: the bar ran diagonally, the eye crossed it
  twice, and the two dead corners were on the one panel that is `position: sticky` and
  therefore permanently on screen. Merging the two rows took the panel from 169px to ~78px
  without moving a single control relative to its neighbours. **Don't split them apart again
  to give the picker room** — the room was never the problem.

  **The no-list warning hangs off the zone, out of flow, and that is load-bearing.** With
  nothing open the priority column is empty for every row, and `#list-warn` says so under
  the picker. It lived in the list menu first, which meant it only appeared once you opened
  the thing it was warning you about. It is two elements: the outer one positions
  (`position: absolute; top: 100%; left: 0` — the picker's left edge, since the picker is
  the zone's first child), the inner `.list-warn-box` is the pill and shrinks to its text.
  It was `flex-basis: 100%` for one commit, and that **contributed a whole warn line to the
  zone's intrinsic width** — the zone measured ~839px instead of the ~507px its controls
  need, wrapped off the filter row, and opened a 332px gap inside itself, in exactly the
  empty-list state it exists for. `.control-row--inputs:has(.list-warn:not([hidden]))`
  reserves the line instead, so the bar is not permanently taller for a message that is
  usually absent. The glyph is white on purpose: fel and the three item-quality colours all
  mean something, and a coloured warning would read as a BiS tier.

  **The strips gave up stickiness for that, and it was chosen rather than overlooked.**
  `.controls--where` does not stick, so they scroll away on a 699-row table, and they *are*
  filters you adjust while reading rows. The where panel is also five rows deep before the
  results begin. Both are the price of the grouping.

  **The picker and `Edit` must stay together.** They were split for exactly one commit and
  it left a dead end: `Edit` is `disabled` on someone else's list with
  `title="Make a copy to edit"`, and `Make a copy` is inside the picker's menu, which was
  then a panel away. A control and the thing that arms it belong within a glance of each
  other. `test/smoke.mjs` pins that they share a row.

  **`.list-zone` is one box, not three loose children** — picker, hint and `Edit` — and it
  carries the row's single `margin-left: auto`. Three loose children each finding their own
  way right is what `.account-zone`'s comment warns about upstream, and at half-screen it
  did exactly that: the row wrapped, `Edit` came off the end alone and landed on the
  **left**. `test/smoke.mjs` pins the auto margin on the zone and **none** on
  `#edit-toggle` or `.edit-hint`, **stripping CSS comments first** — `style.css` discusses
  auto margins in prose, and a rule-body grep finds the discussion and calls it the defect.
  `test/auth.mjs` solves the same trap the same way for the service-role key.

  **The banner carries the title and the account zone, and nothing else.** Signing in is
  about *you*, not about which list is open.

  **The picker is deliberately NOT accented.** `--gold` is `--fel` and it means *selected*
  everywhere on this page; `docs/design-brief.md` lists it as a colour that carries meaning
  and must not move. Prominence is size, weight and contrast instead — a `.95rem`
  600-weight name, a border mixed one step brighter than the hairline every other field
  wears, and the lifted `--bg-panel-2` fill. `test/smoke.mjs` asserts the trigger's rule
  contains **no** `--gold`/`--fel`, because "make it stand out" invites painting it green.

  **Only `.controls--refine` is sticky** — it carries the count and sits directly above the
  results; two sticky panels would fight over `top: 0`.

- **The count's denominator is the phase's total, not the dataset's** (`phaseTotal()`).
  A phase is always set and only one is ever rendered, so `132 of 699` measured the
  fraction against 567 rows that could not have appeared whatever the filters said.
  Unfiltered, every phase now reads `N of N` — 199 in Phase 1, 132 in Phase 2, 195 in
  Phase 3 — which is the honest version of that line.
- **Chip rows have no visible label**, and each leads with a bare `All` chip carrying no
  count, so the rows line up down one edge. What the row is, and what its All chip clears,
  live in `aria-label` (on the `role="group"`) and in `data-tip` — `allChip()` sets both,
  so a new row should go through it rather than calling `chip()` directly. Counts stay on
  the individual chips; the row total is already the `N of N items` line.

---

## 6. Tests

`npm test` runs four files:

- `test/smoke.mjs` — renders the page in jsdom and asserts filtering, sorting, grouping,
  icons, operators, BiS rings, tooltips and the data edits.
- `test/bis-fallback.mjs` — a missing or malformed `bis.json` degrades gracefully.
- `test/edit-mode.mjs` — that zatar's list is read-only and a list of your own is not; New,
  Make a copy, the dropdown, the name field, two-step Delete, and that an edit is in the store
  with nothing pressed to put it there. Then the editor through its click paths: remove via the
  ×, the operator menu, the add popover and its search, the repeat rule, reset,
  and that `ALL` is never mutated. It also greps its own source — so a `window.prompt` can't
  creep back — and asserts **every icon carries `draggable="false"`**, which is the only part
  of the drag gesture jsdom can reach and the exact thing that was broken.
- `test/templates.mjs` — a template is a full copy, a blank one is valid and shareable,
  storage round-trips, the URL encoding round-trips, and eight kinds of hand-crafted bad
  template are each refused.
- `test/auth.mjs` — signing in, against a **fake Supabase that is a working in-memory
  table** rather than a call recorder, so the assertions are about behaviour that
  round-trips. It pins the fail-soft states (unconfigured, and configured-but-CDN-blocked,
  which is the realistic outage), that the store genuinely swaps with the session, that the
  merge offer appears only when the account is empty, and that merging never deletes the
  local copy. The keys are consts inside the IIFE — the right place for them — so the test
  rewrites the source string rather than `app.js` growing a hook that exists only for tests.
  **The OAuth redirect itself cannot happen in jsdom** and is checked by hand, like the drag.

  It also covers the two Aug 2026 additions, and the fake had to grow for both — a fake that
  is laxer than the thing it stands for tests nothing. Its `eq()` keeps every condition
  rather than collapsing them onto the id, or the guarded save would match every time, which
  is exactly the bug being guarded against; and its `rpc` serves `published_priorities` as
  `priorities`, because a fake handing back the draft would pass every assertion while the
  real function served the snapshot.

### Waiting: `test/helpers.mjs`

**Never sleep for a fixed time.** `until(pred)` polls the condition the test is actually
waiting for and continues the moment it holds; `settle(cond)` is the same thing in the files
that already had a `settle`. Flat naps cost 30 of the suite's 47 seconds and were the
flaky-test pattern besides — too short and it fails on a slow machine, too long and nobody
learns it was too short. The suite runs in ~25s now for the same 755 checks.

`until` **resolves on timeout rather than throwing**, so the assertion after it fails with
the message it already had. Keep that: a broken test must report what it always reported.

Three rules learned by getting each of them wrong:

- **The predicate must cover what the next line needs, not just the next assertion.** The list
  menu's rows come from an async refresh, so waiting for "the view changed" then clicking a row
  that had not rendered took the file out with a TypeError — and the run still said 0 failures,
  because it had exited early. **Check the count, not just the colour.**
- **It must be about the new state, not something already true.** `.share-pop` is one reused
  element, so "does it exist" is true from the first open onward. The app's own readiness
  signal — `.share-copy` being enabled, which is when its click listener is attached — is the
  thing to wait for.
- **An assertion that something did NOT happen cannot be polled**, because the poll passes on
  the first tick against a state that has not settled. Those keep a real `sleep`, and each one
  in the suite says in a comment why it is not an `until`.

**Assigning `location.hash` makes jsdom queue a hashchange of its own**, on top of any the
test dispatches by hand. Left pending it fires at the next `await` and runs the app's handler,
which resets the search box to `state.q` — silently undoing anything typed since. `smoke.mjs`
drains it with a `sleep(20)` after each assignment. This was already happening before the
suite was made fast: three search assertions were passing on the unfiltered table, because
`> 0` is true whether the search ran or not.

They can't cover anything needing a real browser: Wowhead's script doesn't complete its
data fetch under jsdom, so **item icons and item tooltips are untested** — check those by
eye at `localhost:8642`.

Importing a phase's loot, in order — each is a dry run until `--write`:

```bash
python3 verify/scrape_drops.py                          # guides -> p1p2-drops.json
python3 verify/fetch_items.py --drops p1p2-drops.json   # + the item database -> rows
python3 verify/fetch_bis.py                             # every spec, every phase
python3 verify/seed_priority.py                         # a starting order for new rows
python3 verify/regroup.py                               # zone, then kill order
```

**`scrape_drops.py` refuses rather than skipping.** Its `HEADINGS` table maps a guide's
section names onto `BOSS_ORDER`, and a heading it has never seen is an error — a silent
skip is how a whole boss goes missing and nobody notices. It is also where the guides'
irregularities are recorded: Wowhead spells one boss `Grull`, the Opera Event's three
outcomes share one table, and Karazhan's three Servant's Quarters rare spawns fold into
the one `Basement` source.

**`fetch_items.py` drops anything that is not gear, and says what it dropped.** Two rules,
because one is not enough: below **epic** quality (which is also what keeps the green accent
unambiguous — see §4), and any slot that is not equippable. The second rule exists because
`Pattern: Soulcloth Vest` is a *purple*: quality cannot tell a pattern, a mount, a quest item
or a 20-slot bag from loot, but "can you wear it" can. 17 rows were caught this way in Phases
1 and 2.

**Tier tokens are the exception to that rule** and are resolved by name, because a token
reports its classes where gear reports a slot. **T4 and T5 group the classes differently
from T6** — Priest is with Warlock at T6 and with Warrior below it — so `TOKEN_SET` in the
tool and `TIER_CLASSES` in `app.js` each carry **six** groupings, not three under different
names. A token type missing from `TIER_CLASSES` renders as bare text rather than three class
icons, which reads as "we don't know who this is for"; `test/smoke.mjs` pins that every type
in the data is known.

Validators, all exiting non-zero on error:

- `python3 verify/check_priority.py` — every identifier resolves, operators are valid and
  present except on the first entry, no duplicate spec in a record.
- `python3 verify/check_bis.py` — keys and ids resolve, `id`/`item` pairs agree, and it
  warns about entries that can never show a ring.

Finished one-shot tools, kept as audit trails: `verify/migrate_priority.py` (string ->
structured priority), `verify/fetch_unique.py` (re-runnable if the item set changes), and
`verify/apply.py` (boss attribution).

---

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
- **Seeding is an action, not stored data, Aug 2026.** The 268 flat `=` lines that used to
  ship in `loot_data.json` were each exactly the specs `bis.json` lists for that item in
  that phase — a duplicate of data the page already draws as rings. `seedFromBis()` fills
  the empty rows of the phase on screen on demand instead, and only on a list of your own.
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

## 8. Attribution (required, keep it prominent)

**The banner is the title alone — currently "Loot Prio Lists" — and carries no credit.** That was a
decision, not an oversight: the credit moves onto the lists themselves once those carry an
author. Until that ships, **the footer is the only place on the page naming the source**, so
§8 rests entirely on it. `test/smoke.mjs` asserts exactly that — banner clean, footer
crediting — so if the footer is ever reworked, the failure says attribution has left the site
rather than letting it go quietly.

The priorities are the work of **[zatar_wow](https://twitch.tv/zatar_wow)**, whose site
`tbc.classicwowbuilds.com` has been offline for years. This is a community mirror, not
original analysis. Reconstructed from their two videos:
[Mount Hyjal](https://www.youtube.com/watch?v=B3zgswtk6T8) and
[Black Temple](https://www.youtube.com/watch?v=6SWlWDYTkvU). Hunter bow priorities were
credited in-video to **Veramos**, arms-warrior input to **Lemonism**.

Item IDs and slots came from [wowsims/tbc](https://github.com/wowsims/tbc). Icons and
tooltips from [Wowhead](https://www.wowhead.com/tbc).

**zatar is a list, not the baseline, Aug 2026.** *Zatar's Phase 3* ships in `data/lists/`
and is offered for Phase 3 like any other starting point. Nothing falls back to it, nothing
is measured against it, and with no list open the priority column is empty. The credit in
the footer is unchanged and still required — demoting him from substrate to author changes
where his work lives, not whose it is.

**Lists carry an author, and it is shown only where something attested it.**
`makeTemplate()` stamps `accountName()` when you are signed in; signed out it stays empty,
and a list with no author claims none rather than claiming to be anonymous. A **copy takes
your name**, not the name of the list it came from — a copy is yours from the moment you
make it, which is the other half of what `base` records.

**A list with no author picks one up on its next save** (`saveNow()`). Every list made
before the field existed has none, and those are exactly the lists worth sharing — the ones
with work in them. It fills a blank and **never overwrites**, so making a copy of someone
else's list cannot quietly relabel the original, and re-saving while signed out cannot blank
one. Safe because `activeIsMine` already guarantees what it needs to: a list in your own
store is yours by definition, so writing your name in is recording a fact, not making a claim.

`attestedAuthor()` is the gate between *an author is set* and *an author is shown*. A `#t=`
link carries whatever the sender put in the payload, so someone could stamp it `zatar` and
pass their calls off as his — which is the exact thing this section exists to prevent. A
`?s=` list came out of the database under its owner's `auth.uid()`, and `loadSharedByToken()`
marks it `sharedFrom: "server"`; only that marker opens the gate. A `#t=` list shows no
byline and keeps its "shared with you" label. **Your own lists show no byline either** — it
would be your own name on every row, which says nothing.

**182 of the 699 rows are zatar's.** His videos covered Black Temple and Mount Hyjal, and
that is the whole of his guide. The other 517 are loot from the raids he never covered —
Phases 1, 2, 4 and 5, imported so the tables are complete — plus 13 T6 items the videos
skipped. `verify/missing-items.md` records the 13. His list simply does not hold a key for
them, which is what the empty priority column says.

**Nothing on screen frames a row as missing from a guide any more, and that was a decision.**
A `NOT IN THE GUIDE` tag was right while the site was a mirror of one guide with holes in
it; it stopped being right once lists became the product and zatar's became one of them.
**The empty priority column says it now, and says it of every list equally.** A list that
does not rank an item shows nothing for it, whoever wrote the list — so there is no claim
to disclaim and no flag to carry. `unsourced`, `prioritySource` and the `SEEDED` tag all
went with the framing.

**The BiS rings are not zatar's either** and must never be presented as if they were — the
videos gave loot-council priorities, not per-spec BiS lists. `data/bis.json` comes from Wowhead's
per-spec BiS guides, one per spec per phase, each URL recorded in
`verify/bis-sources.json`; how long an item stays BiS is derived from
[wowsims/tbc](https://github.com/wowsims/tbc) P4/P5 gear presets. Where the two sources
disagree with each other — 47 entries whose spec the priority never names — both are left
standing rather than reconciled.

Boss attribution for 52 Black Temple items was verified by hand against Wowhead in
Aug 2026 — 27 confirmed, 24 corrected. `verify/boss-attribution.csv` is the record.
