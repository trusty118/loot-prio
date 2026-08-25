-- Two columns the client has been carrying and the database has not.
--
-- NOTES was the bug. Editable notes shipped Aug 2026 and worked perfectly signed out,
-- because localStore writes the whole template blob. Signed in it wrote through
-- remoteStore.save(), whose upsert never named a `notes` column - so the write silently
-- succeeded, the note was dropped, and it was gone on the next load. Every ?s= recipient
-- read the guide's notes rather than the sharer's. Nothing errored anywhere.
--
-- AUTHOR is what CLAUDE.md section 8 has been waiting for: the credit moves onto the
-- lists once those carry one. It lives here rather than only in the payload because a
-- row written under the owner's auth.uid() is ATTESTED - a #t= link carries whatever the
-- sender put in it, and an author nobody checked is exactly the attribution problem
-- section 8 exists to prevent.
alter table lists add column if not exists notes  jsonb;
alter table lists add column if not exists author text;

-- get_shared_list has to return both, or a shared list still arrives without them.
-- Same shape as before: security definer so it can see past the `auth.uid() = user_id`
-- policy, and still only ever able to return one row that is both flagged shared and
-- matched by an exact token. The table itself stays unreadable to anonymous callers.
--
-- DROP FIRST, and it is not optional: `create or replace` refuses to change a function's
-- return type ("cannot change return type of existing function"), and adding notes and
-- author to the returns table is exactly that. Dropping resets the grants too, which is
-- why the revoke/grant at the bottom run after the create rather than being assumed.
--
-- Shared links stop resolving between the drop and the create. That is a fraction of a
-- second inside one transaction, and the alternative - a second function under a new
-- name - would leave the old one behind still handing out rows without notes.
drop function if exists public.get_shared_list(text);

create function public.get_shared_list(token text)
returns table (id text, name text, created date, v int, base text,
               priorities jsonb, notes jsonb, author text)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.name, l.created, l.v, l.base, l.priorities, l.notes, l.author
  from public.lists l
  where l.share_token = token
    and l.shared = true
  limit 1
$$;

revoke all on function public.get_shared_list(text) from public;
grant execute on function public.get_shared_list(text) to anon, authenticated;
