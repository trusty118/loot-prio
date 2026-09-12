# `data/lists/` — why priorities are a list's, not the site's

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

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
