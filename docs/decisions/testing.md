# Tests — what each file covers, and how to wait

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

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
