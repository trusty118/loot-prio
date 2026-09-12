# The build step — why it exists and what it publishes

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

## 9. The build, and what gets published

**This site had no build step until Aug 2026, and the reason it acquired one was not
size.** Pages was set to `legacy`, serving `main:/` — so the live site was serving the
**whole repository**. `CLAUDE.md` (this file, 102 KB of internal notes and bug
post-mortems), `test/smoke.mjs`, the `verify/` scrapers, `docs/` and `package.json` were all
returning `200` at the site's own URL. `.gitignore` already reasoned about exactly that
hazard for zip files — *"Pages serves this directory, so a committed zip would be publicly
downloadable too"* — and the logic had simply never been extended to the docs.

`build.mjs` produces `dist/`, and **`dist/` is the whole of what is published**:

| | |
|---|---|
| `app.js` | esbuild, full minify **including identifier renaming** |
| `style.css` | esbuild, minified |
| `index.html` | comments stripped, blank lines collapsed — deliberately conservative |
| `data/` | **copied verbatim** |

88.8 KB → **29.7 KB** gzipped for the three front-end files.

**Renaming is safe here and that was checked, not assumed**: `app.js` has no `eval`, no
`new Function`, nothing reading a function's `.name`, and it is one self-contained IIFE
exporting no globals. It is `format: "iife"` and never bundled, because the file is loaded
by a plain `<script>` and executes *during* parsing — which is load-bearing for the Supabase
race in §4.

**The data is not minified, on purpose.** JSON carries no comments so there is nothing to
hide, the gzipped saving is small, and it is the one part of this site worth leaving legible
to anyone curious enough to look.

**`test/build.mjs` is what makes the build safe to have.** A build step adds a failure mode
the other five files cannot see — they all read the **source**, which is right, since the
source is the truth and `test/auth.mjs`'s service-role-key grep has to scan the unminified
file. That leaves nothing checking what actually reaches users. It boots `dist/index.html`
and `dist/app.js` in jsdom and asserts the page renders, opens a list and filters; and it
asserts `dist/` holds **only** the four entries, naming `CLAUDE.md`, `test/` and `verify/`
individually. One stray copy line would put the notes back on the internet and nothing else
would complain.

**The workflow's ordering is the point**: `npm ci` → `npm test` → `npm run build` → deploy,
so a red suite cannot reach the live site. **Before it there was no CI at all** — the tests
only ever ran on one machine, and a broken commit was published the moment it merged.

**Pages must be set to "GitHub Actions", not "deploy from a branch."** If it is ever
switched back, the site silently starts serving the repo root again — every file above
becomes public once more, and nothing on the page changes to say so.

**What was lost, and what replaced it.** With no build, what was live was byte-for-byte what
was in the repo: `localhost` *was* production, and a deploy could be verified by curling the
live file and diffing it against the local one. Both are gone. `npm run serve:dist` (port
8643) is the replacement for the first — when a bug might be the minifier's, look there
rather than at 8642. For the second, diff live against a local `npm run build`, and check
that **`/CLAUDE.md` returns 404**, which is the one-line proof the whole arrangement is still
in force.

---
