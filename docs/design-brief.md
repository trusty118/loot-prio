# TBC Loot Prio Lists — visual direction brief

## What this is

A loot-priority reference for World of Warcraft: Burning Crusade Classic. It answers two
questions: **"who should get this item"** (a guild's loot council reads a ranked list of specs
per item) and **"what should I be rolling on"** (a player filters to their own spec). Users are
adults playing a 2007 game in 2026, usually on a second monitor **during a raid**, often
glancing at it for two seconds between pulls. Speed of recognition matters more than beauty.

The priorities are one person's published calls, mirrored and credited. That is the site's whole
reason to exist. The credit currently lives **only in the footer** — the banner is the title
alone — and it is moving onto the lists themselves in a later feature, so treat the footer's
"About & credit" section as load-bearing rather than boilerplate.

**Live site:** https://trusty118.github.io/loot-prio/

States worth seeing, all reachable from there:

| State | How |
|---|---|
| Default | as it loads — Phase 3 selected |
| Zone and boss drilldown | click a zone tile, then a boss |
| Spec filter | click a class icon, then a spec |
| Edit mode | `New` in the banner, then `Edit`, then `+` on any row |
| Empty phase | click Phase 1 |

## Hard constraints

- **No build step, ever.** One hand-written `style.css` (~1,100 lines), vanilla `app.js`, no
  framework, no preprocessor, served straight from a repo root by GitHub Pages. Anything
  proposed has to be expressible as plain CSS.
- **Dark only.** No light mode.
- **Never use a bare element selector** (`table`, `select`, `a`). Wowhead's tooltip script
  injects its own DOM into the page; a bare `table { min-width }` once pinned every item
  tooltip to 940px and could not be overridden. Scope everything to a class.
- **The art cannot be re-cut.** Every image is hotlinked from Blizzard's CDN at fixed sizes —
  boss portraits 128×64, instance tiles 256×128, ability icons 56×56 — and the repo contains no
  binary assets by design. They are PNGs **with soft alpha edges**, so whatever colour sits
  behind them haloes around each silhouette.
- **The results table is `table-layout: fixed`.** Columns are declared in a `<colgroup>`; you
  cannot hide a cell with `display: none` without the rest shifting into the wrong columns.

## Colour that carries meaning, and must survive

This is the part most likely to be broken by a redesign that only considers aesthetics.

- **`--epic` `#a335ee`, `--legendary` `#ff8000`, `--artifact` `#e6cc80`** are WoW's item-quality
  colours, reused here as a **ladder for how long an item stays best-in-slot**: one phase,
  several phases, the whole expansion. They are drawn as rings around spec icons and repeated
  in tooltips. A WoW player reads these instantly and has for twenty years. **They are fixed.**
- **Item names in the table are coloured by quality** by Wowhead's own script — mostly epic
  purple. Any page colour has to sit under that without fighting it.
- **One accent means "this is selected"**, everywhere: chips, tiles, the current phase. One
  accent, one meaning. It is **jade `#2fbf71`** (bright `#58dc93`) as of Aug 2026 — green,
  for TBC. Jade rather than Outland's fel green: that was tried first and at `#8fce00` it
  read as acid against a palette deliberately cooled to slate. The tokens are still named
  `--gold`/`--gold-bright`;
  that is historical and deliberate, since a later expansion just changes the two values.
  Green is normally wrong for a WoW page, because `#1eff00` is uncommon quality — safe here
  only because every item in this dataset is epic or legendary, so no green item name ever
  renders. The swap also fixed a real ambiguity: the old gold sat a few degrees from
  `--artifact #e6cc80`, so "selected" and "expansion BiS" looked alike despite meaning
  nothing like each other.
- **Dimmed and desaturated means "not you"** — spec icons in a priority line that are not your
  spec, and unpicked phase tiles. The contrast between lit and dim is doing real work.
- **Size ranks the navigation**: phase tile 168×84 → zone tile 124×46 → boss pill. Three levels
  of the same hierarchy, told apart by size. If tiles are restyled, keep them visibly ranked.

## Everything else is open

Page background, panel colours and separation, borders, the three text weights
(`--text`/`--text-dim`/`--text-faint`), type scale and family, spacing rhythm, corner radii,
the header treatment, table row striping, hover and focus states, and the shape of the chips
and tiles themselves.

Current palette, for reference rather than as a constraint:

```
--bg #000        --bg-panel #1e1913   --bg-panel-2 #262019   --bg-row #1a1510
--line #3a3128   --line-soft #2c251d
--text #ece3d4   --text-dim #a89a85   --text-faint #7d7160
--gold #2fbf71   --gold-bright #58dc93   (jade; token names are historical)
--radius 6px     --font "Segoe UI", system-ui, …
```

The look is deliberately WoW-adjacent — warm browns, parchment gold — because it sits beside
the game. It does not have to stay that way, but it should still feel like it belongs next to a
WoW window rather than next to a SaaS dashboard.

## The problem worth solving

**Density.** At peak — phase, zone and class all picked — there are about **40 interactive
controls** on screen before the table starts:

| Row | Controls |
|---|---|
| Boss | 11, up to 13 for Karazhan |
| Class | 10 |
| Header / list bar | 8 |
| Phase | 5 |
| Zone | 3–4 |
| Spec | 4 |
| Type, Slot, Search, Reset | 4 |

The navigation is already progressive — zones appear once a phase is picked, bosses once a zone
is — and it still feels busy. **The class and boss rows are the weight.** A direction that makes
that legible, without hiding what a raider needs in two seconds, is the most valuable thing this
brief can get back.

## What to hand back

CSS custom property values, plus component notes for anything that is not just a colour. If
artboards: the default view, a filtered view, and edit mode. Please state where any suggestion
conflicts with the fixed colours or the no-build-step rule, rather than working around it
silently.
