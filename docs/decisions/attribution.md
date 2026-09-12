# Attribution — zatar, authors, and what a byline requires

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

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
them — and since Sep 2026 those rows show the **BiS view** rather than an empty column, which
is the honest rendering of "he never covered this, but here is who it is best for". See §2;
the 23 rows where he *did* answer and the answer was "whoever needs it" stay blank.

**Nothing on screen frames a row as missing from a guide any more, and that was a decision.**
A `NOT IN THE GUIDE` tag was right while the site was a mirror of one guide with holes in
it; it stopped being right once lists became the product and zatar's became one of them.
**The priority column says it now, and says it of every list equally.** A list that does not
rank an item shows no ordering of its own for it, whoever wrote the list — so there is no
claim to disclaim and no flag to carry. Where the list holds no key at all the column falls
back to the BiS view, whose uniform `?` operators say "not ranked against" rather than
claiming an ordering the list never had. `unsourced`, `prioritySource` and the `SEEDED` tag all
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

---
