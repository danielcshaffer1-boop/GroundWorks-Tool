-- Ground Work — platform admin panel (view-only)
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 005_paid_tiers.sql has succeeded.

-- admins — a short allowlist of platform-admin user ids. Membership is
-- managed by hand via SQL (insert/delete a row), not through the app UI —
-- there's no self-service way to become an admin.
create table admins (
  id         uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table admins enable row level security;

-- A signed-in user can check ONLY their own admin status — this doesn't
-- leak the existence of any OTHER admin to a non-admin, since
-- auth.uid() = id scopes the query to a single possible row (their own).
create policy "Users can check their own admin status"
  on admins for select
  using (auth.uid() = id);

-- View-only admin bypass across every table. Additive, not a replacement:
-- Postgres OR's multiple permissive policies for the same command
-- together, so a shop owner's existing policy still applies unchanged —
-- they still only ever see their own rows. An admin additionally sees
-- everything. No write access from this — that's a deliberate, separate
-- step if/when it's wanted.
create policy "Admins can view all shops"
  on shops for select
  using (exists (select 1 from admins where admins.id = auth.uid()));

create policy "Admins can view all items"
  on items for select
  using (exists (select 1 from admins where admins.id = auth.uid()));

create policy "Admins can view all menu items"
  on menu_items for select
  using (exists (select 1 from admins where admins.id = auth.uid()));

create policy "Admins can view all ingredients"
  on ingredients for select
  using (exists (select 1 from admins where admins.id = auth.uid()));
