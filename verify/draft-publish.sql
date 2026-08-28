-- Draft and published: the list officers edit, and the snapshot the guild reads.
--
-- Until now a ?s= link served whatever the row said at that instant, so anyone holding
-- it watched the officers think. These three columns give a list two faces, and they
-- meet only when someone presses Publish.
--
-- The link itself does not change and never has to. It carries a token, not a payload -
-- the token points at this row, and this row now decides which version to hand back. One
-- URL, pinned in Discord once, serving whatever was last published.

alter table lists add column if not exists published_priorities jsonb;
alter table lists add column if not exists published_notes      jsonb;
alter table lists add column if not exists published_at         timestamptz;

-- THE BACKFILL IS NOT OPTIONAL, and it has to run before the new function.
--
-- Every list that is already shared has no snapshot yet. Switch get_shared_list to the
-- published columns without this, and every link already in circulation starts returning
-- a list with no priorities in it - which reads as data loss to whoever opens it, because
-- that is exactly what it looks like.
--
-- Seeding the snapshot with what those links serve right now means nothing visibly
-- changes for anyone: the next thing they see is still the last thing they saw, and from
-- here on the owner decides when it moves.
update lists
   set published_priorities = priorities,
       published_notes      = notes,
       published_at         = now()
 where shared = true
   and published_at is null;

-- The read stays exactly as narrow as it was: security definer so it can see past the
-- `auth.uid() = user_id` policy, still only ever able to return a single row that is both
-- flagged shared and matched by an exact token, and the table itself still unreadable to
-- anonymous callers. What changes is only WHICH columns it hands over.
--
-- `published_at is not null` is the new half of the condition, and it is what "locked
-- until we are happy" actually means: a list nobody has published has no version to give
-- out, so the link resolves to nothing rather than leaking the draft.
--
-- DROP FIRST. `create or replace` refuses to change a function's return type, and this
-- changes it. Same reasoning, and the same fraction-of-a-second gap inside one
-- transaction, as verify/notes-and-author.sql - which also explains why the revoke and
-- grant are repeated rather than assumed to have survived.
drop function if exists public.get_shared_list(text);

create function public.get_shared_list(token text)
returns table (id text, name text, created date, v int, base text,
               priorities jsonb, notes jsonb, author text)
language sql
stable
security definer
set search_path = public
as $$
  select l.id, l.name, l.created, l.v, l.base,
         l.published_priorities, l.published_notes, l.author
  from public.lists l
  where l.share_token = token
    and l.shared = true
    and l.published_at is not null
  limit 1
$$;

revoke all on function public.get_shared_list(text) from public;
grant execute on function public.get_shared_list(text) to anon, authenticated;

-- Note what is NOT here: no function that publishes. Publishing is a plain update run as
-- the signed-in owner under the existing `auth.uid() = user_id` policy. A security
-- definer function taking a token would mean anyone holding the read link could publish
-- over the draft, which is the one way this feature could be got badly wrong.
