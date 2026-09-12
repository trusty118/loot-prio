# Edit mode — the overlay, whose list is on screen, what a template is

> Moved out of `CLAUDE.md` in Sep 2026, verbatim. This is the *reasoning* behind what the map describes: what was tried, what it cost, and why it ended up the way it is. Read it when you are about to change the thing it covers. Dates and "used to" passages are left as they were written.

## 4. Edit mode — your own priority list

> **Reworked and finished, Aug 2026.** [docs/edit-mode-plan.md](docs/edit-mode-plan.md) records
> what changed and why, including two decisions that are easy to undo by accident: the
> `.prio-grip` handle was **dropped** once the real drag bug was found, and the drag itself is
> **only ever verified by hand** — jsdom cannot reach the gesture, so a green suite says nothing
> about it. Re-check by hand if you touch the drag machinery.

The whole data restructure was aimed at this. `priority` became an ordered list of
`{spec|class, op}` entries so a person could reorder icons and pick operators.

**zatar's data is never mutated.** `ALL` stays exactly as loaded, so "back to his order"
is always one click away and a template can be diffed against the original. Edits live in
an overlay:

```js
function effectivePriority(rec) {                       // the template's, else the guide's
  return (activeTemplate && activeTemplate.priorities[rec.id]) || rec.priority;
}
```

**Everything that asks what a row says goes through that**, never `rec.priority`: both
priority cells, `selectionHas()`/`priorityHas()` behind the class/spec filter, and the
search haystack. Two deliberate exceptions read `rec.priority` precisely because they want
the original — the reset button, and whether to offer one.

**`effectiveNotes()` is the same overlay for the notes column, added Aug 2026**, and the
same rule applies: the cell reads it, and so does the **search haystack** — otherwise a
search keeps finding wording you have already replaced, which is the bug the priority
haystack was already written to avoid.

Notes are yours on exactly the terms the priorities are. `copyOfCurrent()` seeds
`template.notes` from `effectiveNotes(rec)` for all 368 records, you edit them, and
`base: "zatar"` records where they came from — there is no new attribution question,
because it is the one the priorities already answered. `newBlankTemplate()` deliberately
does **not** seed them: you asked for nobody's list, and his wording is somebody's.

**Notes did not reach the database for their first weeks, and the shape of that bug is
worth keeping.** `remoteStore.save()`'s upsert never named a `notes` column, so a signed-in
edit saved, appeared to work, and was gone on the next load — while working perfectly signed
**out**, where `localStore` writes the whole blob. Nothing errored: an upsert silently drops
what it does not mention. Every `?s=` recipient read the guide's notes rather than the
sharer's, because `get_shared_list` did not select the column either.

Three defences now, because one was clearly not enough. `test/auth.mjs` edits a note through
the table and asserts it reached the account; it asserts a `?s=` recipient reads it; and the
**fake Supabase projects the columns `get_shared_list` declares** rather than handing back
whole rows, with `RPC_COLUMNS` pinned against `verify/notes-and-author.sql`. A fake that
returns the whole row cannot reproduce a missing-column bug at all — which is exactly why
the original shipped green. **Any new field on a template needs all three: the upsert, the
SQL, and `rowToTemplate()`.**

**`notes` is optional and `TEMPLATE_VERSION` did not move.** Absent means "the guide's", so
every list saved before this and every share link already sent still opens. `validateTemplate()`
refuses a `notes` that is present and wrong — not an object, a value that is not a string, or
one longer than `MAX_NOTE` (600), which is also the textarea's `maxLength` so a list of your
own can never be one your own validator would refuse when it comes back off a link.

### Whose list is on screen

Three views, one variable and one flag:

```js
var activeTemplate = null;   // the list being VIEWED; null means zatar's
var activeIsMine = false;    // is it in your store? false for one from a #t= link
```

**zatar's list is read-only reference, and so is a list that arrived on a link.** Only a
list in your own store is a workspace — `canEdit()` is `activeTemplate && activeIsMine &&
state.editing`, and it is what `renderRow` and `renderPalette` gate on. You get one of your
own two ways, the way Office does it:

- **New** → `newBlankTemplate()`, all 699 rows with every priority empty, `base: "blank"`.
- **Make a copy** → `copyOfCurrent()`, which deep-copies `effectivePriority(rec)` for every
  record. That one function copies the guide's list, one of yours, or a shared one, without
  branching on which — and it is the only way to keep someone else's link.

`state.editing` survives as an **Edit / Done** toggle, but only appears once a list of yours
is open: a finished list gets read during a raid, and it should not be covered in `×`s. It is
cleared by every view change (`openTemplate()` is the single place that happens).

**A row is reachable through its BiS only while reading a list that is not yours.** That path
bridges a gap in *his* data; with a list of your own open there is no gap, and letting 13
rows through a filter the other 182 fail would make your own list lie about itself.

### What a template is

```json
{ "id": "t_9f3c", "name": "MM hunter list", "created": "2026-08-20",
  "v": 1, "base": "zatar", "priorities": { "32375": [ { "spec": "ProtWarr" } ] } }
```

A **full copy** of all 699 priorities, not a diff — **~4,700 characters** gzipped and
base64url'd. It grows with the dataset, and stays workable because it rides in the
**hash**: a fragment never reaches a server, so there is no request-line limit to hit and
the only ceiling is the address bar. The `?s=` path pays none of this — a token is ~30
characters whatever the list holds. Two consequences, both handled
rather than hidden:

- **It is frozen.** Later corrections to `loot_data.json` don't reach a saved template;
  `base` and the date are stored so the UI can say so.
- **Items added later aren't in it.** Anything missing renders from `loot_data.json` and is
  marked as not part of this template, never silently blank (`inTemplate()`).

A **blank list is a template like any other** — it validates, saves and shares; an empty
priority is valid data, not a broken one. Its consequence is that it matches no class or spec
filter, so the chips all read zero. That is honest, and `blankListFiltered()` makes the empty
results say so rather than look broken. **Don't paper over it by extending `bisOnlyMatch()`.**
