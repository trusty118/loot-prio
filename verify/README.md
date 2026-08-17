# Boss attribution verification

52 Black Temple items have `verifyBoss: true` in `data/loot_data.json`. The source video lumped
these mid-instance drops together, so their boss assignment is a best-effort guess rather than
something the creator stated. This folder holds the checklist for confirming them.

## How to check an item

Open its `wowhead` link and look at the **"Dropped by"** line in the tooltip / on the item page.
That is the authoritative answer — one click per item.

## How to record the answer

Edit `boss-attribution.csv`. Two columns matter:

| Column | What to put |
|---|---|
| `ok` | `y` once you have actually checked the row |
| `correct_boss` | pre-filled with the current guess — **only change it if the guess is wrong** |

Leave everything else alone; the other columns are just there to identify the item.

So each row ends up in one of three states:

- `ok = y`, `correct_boss` unchanged → guess confirmed, flag gets cleared
- `ok = y`, `correct_boss` replaced → boss gets corrected, flag gets cleared
- `ok` blank → not looked at yet, stays flagged

Partial progress is fine. Rows you haven't marked simply stay flagged until next time.

## Valid boss names

Spell them exactly like this (copy-paste is safest):

```
High Warlord Naj'entus
Supremus
Shade of Akama
Teron Gorefiend
Gurtogg Bloodboil
Reliquary of Souls
Mother Shahraz
Illidari Council
Illidan Stormrage
Trash
```

If an item turns out not to drop in Black Temple at all, put `REMOVE` in `correct_boss` and note it
in the PR/commit — that is a data error worth handling separately rather than silently re-homing.

## Then

Tell Claude the CSV is updated. It applies the answers back into `data/loot_data.json` (updating
`boss`, clearing `verifyBoss` on confirmed rows), re-runs the smoke test, and pushes — the live
site picks it up on the next Pages build.
