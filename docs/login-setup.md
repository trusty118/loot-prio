# Turning on Discord login

The code is finished and shipped in a dormant state: with no project configured there is
no sign-in button, and the site behaves exactly as it did before. These are the steps that
switch it on. They need your Discord and Supabase logins, so they cannot be automated.

Budget about ten minutes.

---

## 1. Create the Discord application

1. <https://discord.com/developers/applications> → **New Application**. Name it whatever
   the site is called; users see this name on the consent screen.
2. **OAuth2** in the sidebar. Copy the **Client ID** and **Client Secret** (reset the
   secret if it was never revealed — you only get one look).
3. Leave the redirect URL for step 3; Supabase gives you the exact value.

## 2. Create the Supabase project

1. <https://supabase.com/dashboard> → **New project**.
2. **Choose the region nearest you and your raiders.** It is set at creation and cannot be
   changed afterwards — a project in the wrong hemisphere adds a few hundred ms to every
   sign-in and list load, forever.
3. Wait for it to finish provisioning.

## 3. Join them up

1. Supabase → **Authentication → Providers → Discord** → enable it.
2. It shows a **Callback URL** (`https://<project>.supabase.co/auth/v1/callback`). Copy it
   into Discord under **OAuth2 → Redirects**, and save there.
3. Paste the Discord **Client ID** and **Client Secret** into Supabase, and save.

**Note the direction:** Discord redirects to *Supabase*, never to this site. That is why
changing the site's domain later needs no change in Discord at all.

## 4. Allow this site to be redirected back to

Supabase → **Authentication → URL Configuration** → add, as redirect URLs:

```
https://trusty118.github.io/loot-prio/**
http://localhost:8642/**
```

Miss the second and sign-in works live but fails locally, which is a confusing hour.

## 5. Create the table

Supabase → **SQL Editor** → run:

```sql
create table lists (
  id          text primary key,
  user_id     uuid not null default auth.uid() references auth.users on delete cascade,
  name        text not null,
  created     date,
  v           int  not null,
  base        text,
  priorities  jsonb not null,
  updated_at  timestamptz not null default now()
);

alter table lists enable row level security;

-- the entire authorization model: you can only ever see and write your own rows
create policy "own lists" on lists for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

**Do not skip the last two statements.** Without RLS enabled *and* a policy, the anon key
would let anyone read every list in the table. With them, the database itself refuses —
the client cannot ask its way around it.

## 6. Hand over two values

Supabase → **Project Settings → API**:

- **Project URL** — `https://<project>.supabase.co`
- **anon / public key** — the long `eyJ...` string labelled **anon**

Both go into `app.js` as `SUPABASE_URL` and `SUPABASE_ANON_KEY`. **Both are safe in a
public repo.** The anon key identifies the project and authorises nothing; the RLS policy
in step 5 is what protects the data.

**The `service_role` key on that same page is the dangerous one.** It bypasses every
policy. It must never go in this repo, this site, or any browser. `test/auth.mjs` fails the
build if it or any pasted JWT appears in `app.js`.

---

## Afterwards

- Sign in on one machine, make a list, sign in on another, and confirm it is there. That is
  the whole feature.
- The first sign-in on a browser that already has local lists offers **Copy my lists here**.
  It copies rather than moves — the local ones stay where they are.
- **Free projects pause after about a week with no requests** and need a manual restore
  from the dashboard. If that starts biting, a weekly GitHub Action making one trivial
  query keeps it awake, or the Pro plan removes it.
