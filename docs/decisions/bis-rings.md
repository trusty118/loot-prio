# BiS rings — longevity, the two axes, alternates, class icons

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

### BiS rings

`data/bis.json` is keyed by the same identifiers and joined on identifier + item id, then
draws a ring on that spec's icon. Colours follow WoW's item-quality ladder, so "rarer"
reads as "lasts longer":

| Tier | Colour |
|---|---|
| Phase BiS | epic purple `#a335ee` |
| Multi-phase BiS | legendary orange `#ff8000` |
| Expansion BiS | artifact gold `#e6cc80` |
| **Alternate BiS** | **rare blue `#0070dd`** |

**Two independent axes, Sep 2026: the COLOUR says how long, the RING STYLE says whether
there is a condition on it.** A dashed ring means the guide only ever called the item best
*under a condition* — `Best - Hit`, `Regen BiS`, `BiS - Dagger`. Those are real BiS calls
and keep their colour; the broken edge is what stops an item that is merely the hit-rating
choice reading as the flat answer. 168 of 1,889 entries are dashed.

`outline`, not a pseudo element — `.spec-icon` is an `<img>`, and **a replaced element
generates no `::before`/`::after` at all**, so that version renders nothing and fails
silently. `box-shadow` cannot be dashed. `outline` is the only property that draws a broken
ring on an image, and it follows `border-radius`.

**Longevity is one answer per item, shown in every phase it appears.** It was computed per
phase until Sep 2026 — *"if you pick it up in P3, how long does it serve?"* — which could
only ever decay down the ladder: gold in P3, gold in P4, **purple in P5**, because from the
last phase an item has nothing left to outlive. The colour is read as a property of the
item, so a ring that changed colour with the phase you happened to be looking at was
answering a question nobody asked. That change moved **393 of 1,674 entries**, almost all
upward, and is why the table is markedly more orange and gold than it was.

**`conditional` is per ITEM, not per phase**, deliberately: a claim that leans on a
condition anywhere leans on it, so one plain listing among four qualified ones does not earn
a solid ring. Survival's Halberd of Desolation is exactly that — plain `Best` in P4 only —
and this is what keeps all three hunter specs reading the same.

**Not conditional:** wordings that emphasise rather than qualify (`Best Overall`,
`Best Pair`), and a **tank's `threat`/`mitigation` sets**, which are two
genuine kits rather than a caveat. That exception is keyed on the spec carrying `Tank` in
its `roles`, so the three `mitigation` entries hunters carry (Wowhead writes
`Best Survivability` on a hunter two-hander) stay dashed.

**`Best Individually` IS a condition, and reads like emphasis — which is why it sat in the
wrong group for a while.** It means best when the item is judged *on its own*, without the
set bonus it would otherwise be part of: the same shape as `Best - Hit`, not the same shape
as `Best Overall`. Moving it cost 22 entries their solid ring and changed no tier, since
longevity is span-based and `conditional` only decides solid or dashed. Every one of the 22
is a Feral druid, which fits — it is how the druid guides separate a piece from its set.

`Best Pair` stays emphasis, and only because of what it happens to cover here: the
Warglaives of Azzinoth and nothing else, where it describes what you equip rather than when
the call applies.

**Tier pieces are swapped for their TOKEN, Sep 2026 — `verify/tier-tokens.json`.** Tier armour
is not loot: it is what a token turns into, so this dataset lists the **54 tokens** and not the
200-odd pieces. The guides rank the **pieces**, so **492 BiS calls** were landing on items the
site has no row for, and **all 54 tokens showed a blank priority column and no ring at all** —
recorded in §7 as expected noise, when it was really 558 missing rings.

*"Warbringer Breastplate is BiS for Arms"* and *"the Chestguard of the Fallen Defender is what
an Arms warrior wants"* are the same statement; only the second names a row that exists here.

**A token is uniquely identified by (tier, slot, class)** — tier from the set name, slot from
the piece's own item data, class from the guide naming it. 232 of 234 candidates resolved to
exactly one token; the two that did not are a gun and a libram that merely contain a set name,
caught by the slot check rather than by eye.

**The set table was verified, not remembered:** all 27 tier sets checked against which classes
actually name them across 549 guide rows, **zero disagreements**.

**The swap happens before anything counts the row**, so slot capacity and longevity both see
the token — sound because a token occupies the piece's own slot. It is why Arms' P1 chest reads
*Terrorweave Tunic* first and the T4 token as near-BiS behind it, which is exactly what that
guide's blurb says in words.

**A substituted token never matches its guide name**, since the guide named the piece. The
mismatch report skips them, or all 558 would be reported as data errors by design.

**The same file carries PER-ROW overrides, keyed as the review page prints an id** —
`"Arms/P1/28730"`. The rank map reaches a wording; this reaches a row, and it exists because
**plenty of conditions live only in the author's prose**. Arms' Phase 1 ring slot forced it:
four rings all ranked plain `Best`, with the blurb saying *"your second ring will depend on
your hit rating … Mithril Band of the Unscarred and Ring of Arathi Warlords will be your go-to
if you are over the hit cap"*. Overriding `Best` for Arms would have hit every row in that
guide.

**`qualifier()` is one function because the first version was not.** Three places ask what
qualifier a row carries — slot capacity, `cond_items`, and the written entry — and they each
called `variant_for()` separately. That was harmless until an override could change the
answer: capacity still read the raw rank, so a row given a qualifier by hand still counted
against the plain group and stayed marked `near`. The override set the variant and not the
ring, which is worse than not having the override at all.

**`verify/rank-map.json` is where an author's wording gets overruled.** Keyed on **(spec,
exact rank string)** → `{ bis, near, variant }`, consulted **before** the rules, which stay
as the default — so an unlisted wording behaves exactly as it does today and an **empty file
changes nothing**, proved by regenerating `bis.json` byte-identically. Keyed on spec rather
than guide url because that is what every other data file here keys on and it survives
Wowhead reorganising urls; where three specs share one author the identical entries are
honest rather than redundant.

It started empty on purpose, and the first entry earned its way in: **`Game Best`**, which
the warrior guides write for Dragonspine Trophy in P1 and nowhere else in the scrape.
`RANKED_BIS` tests for "best" at the START of the rank, so a claim that puts it last was
dropped - while the same guides write plain `Best` for the same trophy in P2-P5, where it
reads as expansion BiS. P1 was the odd one out of its own five.

Two rows, two specs, and the fix is two lines of data rather than a regex that would have
had to distinguish `Game Best` from `Second Best` and `Near Best`, which lead with a
qualifier for a reason.

**`scan_rows()` also captures the SLOT HEADING and the author's BLURB**, used by nothing in
the pipeline and existing solely so a wording can be reviewed. A rank cell cannot be judged
alone: the feral bear guide ranks Shadowmoon Destroyer's Drape `Threat Alternative`, and the
only thing that settles whether that means "not BiS" or "BiS for threat" is the sentence
above the table naming two *other* cloaks as best. `verify/dump_bis_raw.py` records both, and
the review page groups **by slot** with every row of it shown together — including under
search, where narrowing a slot to the matching row would remove exactly the context the page
exists to supply.

**Authors differ, and the line between them is CLAIM versus OFFER, Sep 2026.** Each Wowhead
spec guide has a different author and they share no vocabulary — **77% of the 627 distinct
rank strings are used by exactly one spec**. `Hit Alternative` (Arms) and
`Threat Alternative` (Feral bear) are offers; `Best without Madness/Stormrage` (BM) is a
claim with a condition on it. One set of regexes cannot be right for all of them, but that
one distinction holds across guides that agree on nothing else.

**An offer that names a REASON is an alternate — blue.** `OFFERED` and `NAMES_A_REASON` in
`fetch_bis.py`: 292 entries, +28 icons on the Phase 3 meta view. An offer naming none —
bare `Option`, `Great`, `Good`, `Viable` — stays invisible, because a ring on it says only
"somebody listed it". Measured: including those is 2,961 entries and +167 icons, roughly
doubling the view.

An offered alternate **never consumes slot capacity**. Otherwise a row the author merely
suggested would push a row the author called best into being an alternative — which is what
had happened to Berserker's Call, third in a trinket slot of two.

**`with X` / `without X` are conditions, and `until X` also CAPS the run.** They map to the
variant `unless`, which exists to give them a slot group of their own; the word is suppressed
on screen via `SILENT_VARIANTS`, because "Phase BiS - Unless" tells a reader nothing and the
condition names another item, which is freeform prose we do not parse. Four rows rendered as
alternatives before this, when the author had called them best.

`until` goes further and sets **`superseded`**: `Best until Unforgivable Sin` names the item
that replaces this one, so that phase is the author saying the run *ends* — the opposite of
what `expansion` claims. The listing still rings; it just cannot be the evidence that
anything lasted. **Stored in the file rather than left implicit**, because `test/smoke.mjs`
derives the longevity rule a third time and has no access to the rank text.

**Freeing rows from `near` changes tiers, necessarily** — 10 did. A near row is excluded from
longevity by design, so anything that stops being near grows its item's span. Worth expecting
rather than rediscovering.

**Blue is drawn for `near`, which drew nothing at all before.** 215 entries a guide listed
as `Best` past what the slot can hold — by its own row order, the second or third choice.
They were stored, validated by `check_bis.py`, and rendered by nothing, so an item could
look unwanted when a guide had named it. Blue sits *below* epic on the quality ladder, which
is why `bisRank()` exists: a class icon takes the best tier among its specs, and the numeric
maximum would have let one spec's alternative outrank another's expansion pick.

**`bisPick()` is the guard against the blue rung leaking.** `bisTier()` answers 4 for an
alternate because it draws a ring; but an alternate is not the pick, so it must not seed a
list, satisfy `BiS only`, or bridge a row through `bisOnlyMatch()`. Those ask "is this BiS";
only the rendering asks "does this draw a ring".

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
