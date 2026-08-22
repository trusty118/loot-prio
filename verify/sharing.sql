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
