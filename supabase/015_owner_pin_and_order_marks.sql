-- GroundWorks — owner PIN and "ordered" marks
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 014_square_sizes_modifiers.sql has succeeded. Safe to run twice.

-- ---------------------------------------------------------------------
-- shop_owner_pins — an optional PIN that locks a shop's settings (editing
-- items, Recipes, Alerts, billing) so baristas on a shared device can count,
-- log usage and receive deliveries without being able to change them. The PIN
-- is only ever stored hashed (scrypt, per-PIN salt) and only the server
-- (service role) can touch this table: RLS is on with no policies.
-- failed_attempts / locked_until slow down guessing (5 wrong tries = 5 minute
-- lockout).
-- ---------------------------------------------------------------------
create table if not exists shop_owner_pins (
  shop_id          uuid primary key references shops(id) on delete cascade,
  pin_hash         text not null,
  failed_attempts  integer not null default 0,
  locked_until     timestamptz,
  updated_at       timestamptz not null default now()
);
alter table shop_owner_pins enable row level security;

-- ---------------------------------------------------------------------
-- order_marks — "somebody already ordered this" on the What to order list, so
-- two baristas on different phones don't both place the same order. One row
-- per marked item; removed when the item is received (Delivery) or un-marked.
-- Same ownership pattern as the other inventory tables: owner-scoped, any paid
-- plan.
-- ---------------------------------------------------------------------
create table if not exists order_marks (
  item_id    bigint primary key references items(id) on delete cascade,
  shop_id    uuid not null references shops(id) on delete cascade,
  marked_at  timestamptz not null default now()
);
create index if not exists order_marks_shop_id_idx on order_marks (shop_id);
alter table order_marks enable row level security;

drop policy if exists "Shop owners manage their own order marks" on order_marks;
create policy "Shop owners manage their own order marks"
  on order_marks for all
  using (
    auth.uid() = shop_id
    and exists (select 1 from shops where shops.id = auth.uid() and shops.tier in ('standard', 'pro'))
  )
  with check (
    auth.uid() = shop_id
    and exists (select 1 from shops where shops.id = auth.uid() and shops.tier in ('standard', 'pro'))
    and exists (select 1 from items where items.id = order_marks.item_id and items.shop_id = auth.uid())
  );

drop policy if exists "Admins can view all order marks" on order_marks;
create policy "Admins can view all order marks"
  on order_marks for select
  using (exists (select 1 from admins where admins.id = auth.uid()));
