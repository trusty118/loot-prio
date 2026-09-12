# `bis.json` — sources, seeding, the BiS view, tokens and the rank map

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

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
not change somebody else's source out from under them. `seedPriorities()` reads it too, so
a list started while WoWSims is selected arrives with different lines from one started on
Wowhead — and on Phase 3, where WoWSims has nothing, it arrives empty.

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

**A new list arrives seeded from BiS, Aug 2026 — there is no control for it.**
`newBlankTemplate()` runs `seedPriorities()` once on the way out of `New`, filling every
item that is BiS for somebody with those specs joined by `=`, as a starting point to drag
into an order. **This is explicitly an interim answer** and is expected to be revisited.

It replaced a `Load BiS data` button on the bar, which replaced an item in the list menu.
The button was found where the menu item was not, and then the question became why it had
to be pressed at all: the list it filled was useless until you pressed it, so the press was
a step with no decision in it. Automatic, the list you make is usable immediately.

Three properties, and **two of them are invisible from the screen**:

- **It seeds every phase**, not the phase on screen. `bisAt()` defaults to `state.phase`, so
  seeding without passing one silently fills only what you happen to be looking at — and the
  list then reads as empty the moment you change phase. A list is a full copy of all 699
  rows, so seeding has to match. `seedPriorities()` maps zone → phase and asks about each
  item under its own.
- **It fills only what is empty**, so it can never overwrite a call. That is why it is safe
  to be automatic, and it is what would let it be re-run later without an "are you sure".
- **Notes are not seeded**, unchanged. BiS is a computed fact about an item; a note is a
  person's sentence about it.

**`Make a copy` does not seed**, deliberately. A copy carries somebody's calls, and their
deliberate blanks are part of what they said — zatar's 23 "whoever needs it" rows are an
answer, and filling them from BiS would overwrite that answer with a different claim.
Only a list started from nothing gets seeded, because there is nothing there to misrepresent.

**With no list open the priority column shows the BiS view**, Aug 2026: every spec an item
is best-in-slot for, in the phase on screen, from the selected source. Without it the whole
of `bis.json` was invisible — rings hang off spec icons in the priority column, and with no
list there were no icons, so 1,889 entries and the `BIS FROM` control had nothing to show
while `bisOnlyMatch()` went on filtering by them. The data could narrow the table and could
not be looked at.

**It must not read as a ranking, and two things keep it honest**: the `?` operator between
every pair, which says "not ranked against" in the same words its tooltip uses; and registry
order rather than any order implying preference.

**There were three, and the third was removed once it expired.** A quiet `BIS` label sat in
front of the icons, on the reasoning that icons under a column headed PRIORITY read as a
priority unless something says otherwise. That was written when this view carried **no
operators at all** — it said "not an ordering" by absence, and the label was what stopped the
absence going unnoticed. `?` then replaced the absence with a louder signal making the same
claim, and the label was left over from a version of the view that no longer existed. The
priority column now contains no prose at all, in any state, and `test/smoke.mjs` asserts
exactly that rather than discounting a label to get there.

**Shown with no list open, and — Sep 2026 — also on a row the open list has NO KEY for.**
The gate is `inTemplate()`, which had been sitting in `app.js` with no callers since the
template work and turns out to be exactly the distinction this needs.

**A missing key is not an empty priority, and the whole change rests on the difference.**
`[]` is somebody answering *"whoever needs it"* — 23 of zatar's rows are that, deliberately.
A missing key is the list never having mentioned the item at all: his videos covered Black
Temple and Mount Hyjal but skipped **13 of their drops**, 9 of which are BiS for somebody.
Filling the first would overwrite an answer; filling the second says something about an item
the list had no opinion on. `!![]` being `true` is what makes `inTemplate()` draw that line.

**It closes a gap the page had on both sides of.** `bisOnlyMatch()` already reached this far
for the *filter*, letting those rows through on their BiS — so with a spec picked you could
land on a row that matched **because** it was BiS for you, and then showed nothing saying
why. Shadowmoon Destroyer's Drape is the worked example: BiS for seven specs in P3, absent
from zatar's list, and it appeared under a Fury filter with an empty priority column.

This **overturns the earlier rule** that an item a list does not rank stays blank, which was
right when the only alternative was filling in every silence. Narrowing it to no-key rows
keeps what that rule was protecting — a list is never made to look like it ranks something it
does not — while dropping what it was costing.

**Never while editing.** `canEdit()` short-circuits it: these icons are not in the list, so
they must not look like entries you can drag, reorder or delete. An editable empty cell
offers its `+` instead. In practice the case barely arises there, because
`copyOfCurrent()` and `newBlankTemplate()` both write a key for **every** record — so a
list of your own has no missing keys until the dataset grows past it.

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
