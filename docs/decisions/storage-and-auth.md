# Storage and sign-in — async stores, PKCE, fail-soft, the save guard

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

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
