# Layout conventions that are easy to break, and how each was learned

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

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
  reintroduces exactly that skew. **The build did not**: `build.mjs` copies `data/` into the
  same artifact as the minified `app.js`, so the two still land in one deploy.
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

  **The no-list warning is a SIBLING of the zone, not a child of it, and that distinction
  is the whole of it.** With nothing open the priority column is empty for every row, and
  `#list-warn` says so under the picker. It lived in the list menu first, which meant it
  only appeared once you opened the thing it was warning you about. It is two elements: the
  outer one takes a line of `.site-header-row` (`flex-basis: 100%`, `justify-content:
  flex-end`), the inner `.list-warn-box` is the pill and shrinks to its text. The glyph is
  white on purpose: fel and the three item-quality colours all mean something, and a
  coloured warning would read as a BiS tier.

  **Two earlier arrangements failed in opposite directions, and both were children of the
  zone.** As a child with `flex-basis: 100%` it **contributed a whole warn line to the
  zone's intrinsic width** — the zone measured ~839px instead of the ~507px its controls
  need, wrapped off the filter row, and opened a 332px gap inside itself, in exactly the
  empty-list state it exists for. So it was made `position: absolute` instead, which fixed
  that and created the opposite problem: out of flow it takes **no** space, so a rule on a
  different element had to hold the line for it —
  `.control-row--inputs:has(.list-warn:not([hidden]))`. **Two rules in two places that have
  to agree, with nothing checking they still refer to the same element.** When the bar
  rework moved the zone into the banner the reservation stayed pointing at the row it had
  left, matched nothing, and the pill spilled across the header's bottom border onto the
  phase tiles and the `Settings` button, at every width.

  As a **sibling** neither is possible: it is a child of `.site-header-row`, which is full
  width already, so it cannot widen the zone — and it is in flow, so nothing else has to
  reserve its space. The header is a line taller only while the warning shows, which is the
  one state where the table cannot answer anything anyway. **Don't put it back inside
  `.list-zone` in either form.**

  **The test that missed it is the more useful lesson.** `test/smoke.mjs` pinned the
  reservation rule by grepping the **stylesheet text**, so it proved the rule *existed* and
  never that it still *matched anything* — it stayed green across two commits with the bug
  live on screen. jsdom lays nothing out, so there was no `getComputedStyle` fallback
  either. What is asserted now is that **no** `:has(.list-warn` rule exists anywhere, which
  is a claim a text search can actually settle, plus that the element is not inside
  `.list-zone`. A layout bug this class of test cannot see has to be checked by eye.

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
