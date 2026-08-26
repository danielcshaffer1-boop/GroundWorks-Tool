-- Ground Work — Supabase schema (step 1 of 6)
-- Run in Supabase Dashboard -> SQL Editor -> New query -> paste -> Run.
--
-- This REPLACES the earlier single-table/JSON-blob schema from before the
-- roadmap was set. If you already ran that older schema.sql in a live
-- project, drop it first:
--   drop table if exists shops cascade;
-- (cascade is safe here — nothing references it yet.)

-- ---------------------------------------------------------------------
-- shops
-- One row per shop, and shops.id IS the Supabase Auth user id (not a
-- separate generated key). That 1:1 link is what step 2's "create a
-- matching shops row on signup" hooks into, and it's what makes step 3's
-- RLS policies a plain `auth.uid() = shop_id` check on every table below,
-- with no join back to an owners table required.
-- ---------------------------------------------------------------------
create table shops (
  id         uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  tier       text not null default 'basic' check (tier in ('basic', 'pro')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- items — one shop's inventory rows
-- ---------------------------------------------------------------------
create table items (
  id           bigint generated always as identity primary key,
  shop_id      uuid not null references shops(id) on delete cascade,
  name         text not null,
  category     text not null check (category in ('perishable', 'dry', 'disposable')),
  unit         text not null,
  count        numeric not null default 0,
  threshold    numeric not null default 0,
  unit_size    numeric,          -- nullable: not every item has a recipe-usable size
  unit_measure text,             -- nullable: pairs with unit_size (e.g. "oz", "pumps")
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- menu_items — Pro-tier recipes, scoped to a shop
-- ---------------------------------------------------------------------
create table menu_items (
  id         bigint generated always as identity primary key,
  shop_id    uuid not null references shops(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- ingredients — one row per (menu_item, inventory item, amount used)
-- item_id intentionally has NO ON DELETE CASCADE: deleting an inventory
-- item shouldn't silently delete recipe lines that reference it (that's
-- the "some ingredients reference an item that no longer exists" state
-- the UI already handles). ON DELETE RESTRICT blocks the delete instead;
-- swap to SET NULL + a nullable item_id later if you'd rather allow it.
-- ---------------------------------------------------------------------
create table ingredients (
  id           bigint generated always as identity primary key,
  menu_item_id bigint not null references menu_items(id) on delete cascade,
  item_id      bigint not null references items(id) on delete restrict,
  amount       numeric not null,
  created_at   timestamptz not null default now()
);

-- Helpful indexes for the lookups the app does constantly (all rows for a
-- shop, all ingredients for a menu item).
create index items_shop_id_idx on items (shop_id);
create index menu_items_shop_id_idx on menu_items (shop_id);
create index ingredients_menu_item_id_idx on ingredients (menu_item_id);
create index ingredients_item_id_idx on ingredients (item_id);

-- Keep updated_at current on edit, on the three tables that have it.
create function set_updated_at() returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger shops_set_updated_at before update on shops
  for each row execute function set_updated_at();
create trigger items_set_updated_at before update on items
  for each row execute function set_updated_at();
create trigger menu_items_set_updated_at before update on menu_items
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------
-- RLS: enabled now, fail-closed, with zero policies yet.
-- That means NOTHING can read/write these tables right now — not the
-- anon key, not a logged-in user, nothing but the service_role key. This
-- is deliberate: step 3 is exactly where the real policies get added.
-- Don't skip ahead and add permissive policies before then.
-- ---------------------------------------------------------------------
alter table shops enable row level security;
alter table items enable row level security;
alter table menu_items enable row level security;
alter table ingredients enable row level security;
