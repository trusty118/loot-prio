# Live shared links — the SQL

Server-side sharing needs two columns and one function.

> **Run [`verify/sharing.sql`](../verify/sharing.sql), not this file.** Open that and copy
> all of it into the Supabase **SQL Editor**. The block below is the same text, reproduced
> here so this page explains itself — but a Markdown heading pasted into a SQL editor is a
> `syntax error at or near "##"`, which is exactly what happens when someone copies the
> page instead of the fence.

It is safe to run on the existing `lists` table, does not touch any rows, and is safe to
re-run: the `alter table` lines are `if not exists` and the function is `create or
replace`.

```sql
-- A share link points at a token, never at the list id. Ids are `t_9f3c` - four hex
-- characters - so a link built from one could be guessed by trying ids until something
-- came back. The token is 128 bits of randomness generated in the browser.
alter table lists add column if not exists share_token text unique;
alter table lists add column if not exists shared boolean not null default false;

-- The narrow read. The `lists` table itself stays unreadable to anonymous callers: the
-- existing policy is still `auth.uid() = user_id` and nothing relaxes it.
--
-- The obvious alternative - a policy of `using (shared = true)` - would have let anyone
-- select every shared list on the site in one query. Shared lists are meant to be
-- readable by people who have the link, not enumerable by people who do not.
--
-- security definer is what lets this function see past that policy, and it can only
-- ever return a single row that is both flagged shared and matched by an exact token.
create or replace function public.get_shared_list(token text)
returns table (id text, name text, created date, v int, base text, priorities jsonb)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.name, l.created, l.v, l.base, l.priorities
  from public.lists l
  where l.share_token = token
    and l.shared = true
  limit 1
$$;

revoke all on function public.get_shared_list(text) from public;
grant execute on function public.get_shared_list(text) to anon, authenticated;
```

## Checking it

**Table Editor → `lists`** should show the two new columns, and the RLS badge must still
say enabled — nothing above changes the policy.

The function is verifiable without the site: an anonymous call with a token that does
not exist must return an empty array, and a bare read of the table must still be
refused.

```bash
# empty array = working
curl -s -X POST "$PROJECT_URL/rest/v1/rpc/get_shared_list" \
  -H "apikey: $PUBLISHABLE_KEY" -H "Content-Type: application/json" \
  -d '{"token":"definitely-not-a-real-token"}'

# [] = row-level security is still doing its job
curl -s "$PROJECT_URL/rest/v1/lists?select=id" -H "apikey: $PUBLISHABLE_KEY"
```

## What it changes

- **Signed in**, `Copy link` gives `?s=<token>` — a short link that carries no list
  data, so notes and priorities can be any length.
- **The link is live.** Fix a call and everyone holding the link sees it on refresh.
- **Signed out**, `Copy link` still gives the `#t=` link it always did: there is nothing
  in the database to point at, and the site has to keep working without one.
- **Stop sharing** clears the flag; the link stops resolving. Deleting the list does the
  same, which is the honest consequence of a link being live rather than a copy.
