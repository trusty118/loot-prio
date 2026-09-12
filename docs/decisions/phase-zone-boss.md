# Phase, zone, boss — art tiles, the phase as a mode, World Bosses

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

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

**`World Bosses` is a zone under Phase 1, Sep 2026** — Doomwalker and Doom Lord Kazzak, who
were there from launch. It is a zone in the sense `Crafted` is: a **source of loot** rather
than an instance. 15 items, and the point of adding them is that **90 BiS entries** pointed
at them and had nowhere to land.

**Its tile wears the FEL REAVER's portrait, standing in for Doomwalker.** The Encounter
Journal has nothing for either world boss, so every `ui-ej-boss-doomwalker` slug 404s — but
Doomwalker is the same kind of fel construct and Wowhead does have art for the Fel Reaver.
It matters that it is journal art rather than an item icon: at 128x64 it frames exactly like
every other zone tile.

**That also fixed a wrong assumption in the zone tile.** `.chip--emblem` letterboxes a square
item icon so `object-fit: cover` does not crop it to a middle band, and it was applied by
testing `BOSS_ORDER[z]` — *"a zone with bosses has journal art"*. World Bosses is the
counter-example, and its square stand-in icon was being cropped. It now tests the **art url**
for the journal prefix, which is what the boss rail already did.

Boss attribution came from the **Source column of Wowhead's own BiS guides**
(`Drop: Doomwalker (World Boss)`) — the same evidence every other zone rests on, not an
id-range guess. **Five more epics in the same id block are deliberately absent**
(30722, 30725, 30731, 30732, 30735): no guide ranks them, so nothing states which boss drops
them, and `verify/world-boss-drops.json` does not guess.

Two things it exposed:

- **`fetch_items.py` was still writing `priority: []` and `unsourced: true`** — fields that
  left `loot_data.json` when zatar became a list. Nobody had run the tool since, so running
  it quietly reintroduced two dead fields. `test/smoke.mjs` caught it on the first run.
- **A boss chip with no portrait rendered as an empty clickable box.** The rail hides
  `.chip-label` so a portrait can carry the name, and four encounters have no journal art at
  all — Karazhan's **Basement** and **Chess Event**, plus the two world bosses, who never
  stood in an instance. The first two had been invisible since the rail was built.
  `chip()` marks them `.chip--noart` and the rail exempts them, the way it already exempted
  `All`. They need padding too: a portrait fills the cell edge to edge, which is why the rail
  has no gaps, so without it the two read as `DoomwalkerDoom Lord Kazzak`.

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
