# Sharing by link — `?s=` and `#t=`, draft and published

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

### Sharing by link

**Sharing has its own control and its own popover, Aug 2026 — nothing about it is in the
list menu.** It used to be an item four deep in that dropdown, which is to say nobody found
it. `#share-trigger` sits in `.list-zone` between the picker and `Edit`: *which list · give
it to someone · change it.* Icon-only, name on `data-tip` and `aria-label`.

**The item it replaced was dead in the state most people meet first.** `copyShareLink()`
opened `if (!activeTemplate) return;`, so on zatar's list the menu offered `Copy link`, you
pressed it, and **nothing happened** — no clipboard write, no message, no error. That is the
first share control anyone sees, since it is what you get before making a list of your own,
and it passed 739 checks. `test/smoke.mjs` now pins that a link comes out **in every state
the control is offered in**, which is the assertion that was missing.

**The popover is the seventh overlay** and is built like the other six: created once,
parented to `<body>`, positioned by `placeUnder()`, closed by Escape and by an outside
`mousedown`. Two faces, swapped in place the way the list menu swaps rename and delete:

- **publish** — a list of yours, signed in, not shared yet. Says what publishing does, and
  offers a button. This face exists so that *opening* the popover never publishes: looking
  at a thing must not change it. It is the same instinct that named the old menu item
  `Share this list…` rather than `Copy link` — a label, or a panel, that hides a side effect
  is a bad one.
- **link** — the URL in a read-only field, selected on open, with **Copy** beside it and
  `Stop sharing` beneath where there is something to stop. Everything else opens straight
  onto this: signed out, zatar's list, or an already-shared list has nothing to publish.

**`Stop sharing` moved here from the menu**, next to the link it stops rather than next to
Delete.

**On zatar's list the link is the current page URL, hash and all** — `location.hash` already
carries phase, zone, boss, class, spec and the search, so *here is what I am looking at* is
a real thing to send, and it is what the dead item was pretending to do.

**`offerLink()` and `#tpl-link-out` are gone.** That hidden field existed only to reveal the
link by hand when the clipboard API refused — which is exactly what the popover now is,
permanently. Removing it also removed one of the three `[hidden]`-versus-`display` traps §5
records.

**The popover's buttons wear the accent and the trigger does not**, which is not a
contradiction. Green means *selected* **on the page, among things you can select** — so the
trigger, sitting on the bar among chips, stays quiet slate. Inside an overlay there is
nothing selectable and the accent reads as "this is the button", the same licence
`.prio-add` takes when the `+` is the only thing to do in an empty cell.

**Two paths, chosen by whether you are signed in, and they mean different things.**

**Signed in → `?s=<token>`.** It carries a token, not the list, so it is ~30 characters
however much the list holds — which is what makes unbounded notes possible at all.
`Stop sharing` clears the flag and the link stops resolving; so does deleting the list.

#### Draft and published, Aug 2026

**The link used to be live**, serving the row as it stood that instant — so officers
reshuffling at 8pm were doing it on everyone's screen. A list now has two faces: the
**draft** its owner edits, and the **published snapshot** the link hands out. They meet only
when someone presses Publish (`publishNow()`), and `get_shared_list` returns the
`published_*` columns.

**The URL never changes, and that is the whole point of it being a token.** The link points
at the row; the row decides which version to serve. One URL, pinned in Discord once, serving
whatever was last published — so publishing is never "send everyone a new link".

**Publish is a plain owner-authenticated `update` under `auth.uid() = user_id`. It must
never become a security-definer function taking a share token** — that would let anyone
holding the read link publish over the draft, and it is the one way this feature can be got
badly wrong. Reads go through the narrow definer function; writes only ever happen as the
owner. `verify/draft-publish.sql` says so at the bottom, where someone adding a "publish by
link" feature would be looking.

`published_at is not null` is the other half of the read condition, and it is what "locked
until we are happy" means: a list nobody has published resolves to nothing rather than
leaking the draft. `shared` is untouched and still the link's on/off switch — the two
answer different questions, *is there a link* and *what does it serve*.

**The migration backfills, and that is not optional.** Every already-shared list has no
snapshot, so switching the function over without seeding one would make every link in
circulation return a list with no priorities — which reads as data loss, because that is what
it looks like. `verify/draft-publish.sql` copies the live columns into the published ones for
exactly those rows first.

`changedSincePublish()` counts items, not keystrokes, because *"23 items have changed"* is
the number a loot council can act on. It is what the share panel offers `Publish changes` on.

**`renderShareLinkFace()` carries a render token (`shareRender`).** `shareLink()` is async and
the face is rebuilt whenever it is reopened or republished, so without it an earlier call
resolving late writes its url into a field that has already been thrown away — and the panel
on screen stays on "Preparing…" for good.

**Signed out, none of this appears**, and nothing is lost by that: a `#t=` link *is* the list,
frozen the moment it is copied, so copying the link already was publishing.

**The token is never the list id.** Ids are `t_9f3c` — four hex characters — so a link built
from one could be guessed by trying ids until something came back. `makeShareToken()` is 128
bits from `crypto.getRandomValues`.

**Anonymous reads go through a `security definer` function, not a relaxed policy.** The
obvious `using (shared = true)` would let anyone select **every shared list on the site** in
one query; shared lists should be readable by people who have the link, not enumerable by
people who do not. `get_shared_list(token)` can only return a row that is both flagged
`shared` and matched by an exact token, and the `lists` table itself stays unreadable to
anonymous callers. `docs/sharing-setup.md` has the SQL and the two curl checks that prove it.

**The recipient needs no account, and that is the point.** `supabaseReady()` checks
`sb && supabaseConfigured()`, deliberately **not** `signedIn()`, and the SQL grants
`execute` on `get_shared_list` to `anon` as well as `authenticated`. Most people who open
a shared link will never sign in — it is the primary path through the feature, so
`test/auth.mjs` exercises it on a window that never calls `_signIn()`. It also asserts the
recipient side honours `Stop sharing`: a token whose row is no longer flagged opens
nothing. Without that, the button would be a lie told only to the sharer.

**Shared links depend on the Supabase project being awake.** The free tier pauses after
~a week idle (see `docs/sharing-setup.md`), and a paused project fails as a transport
error rather than an empty answer — which is why the two cases say different things.

**A shared link that cannot be resolved says so; losing sign-in does not.** `whenSupabaseReady()`
takes a failure callback for exactly this. The absent sign-in button already communicates
"no accounts here", but a visitor who followed a link to one specific list would otherwise be
looking at a different list with nothing to explain the swap. The page still renders behind
the message: it costs the shared list, not the site.

**Signed out → `#t=`, exactly as before.** There is nothing in a database to point at, and
the site has to keep working without one. That link is frozen and size-capped, which is the
honest trade.

**A `?s=` link cannot be read at boot** — the SDK is still arriving. `loadSharedTemplate()`
reports it as handled and `initAuth()`'s `getSession()` is where it actually resolves. Same
shape as the sign-in race, for the same reason.

### The `#t=` encoding

`encodeTemplate` / `decodeTemplate` gzip via `CompressionStream` and base64url into `#t=`.
The `z` prefix marks gzip, `r` raw base64 for browsers without it. In the **hash fragment**
it never reaches a server.

A template from a link is **untrusted input**. `validateTemplate` enforces the same rules as
`verify/check_priority.py` — identifiers resolve, operators are among the five, the first
entry has no `op`, no illegal repeats — and refuses with a readable message rather than
rendering a broken table. `test/templates.mjs` hand-crafts one violation of each.

It opens as **reference, not as yours**: the dropdown says `Shared: <name>`, nothing of theirs
is written to your store, and Make a copy is how you keep it.
