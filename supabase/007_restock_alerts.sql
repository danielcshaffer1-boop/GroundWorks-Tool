-- Ground Work — restock alert recipients
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 006_admin.sql has succeeded.

create table alert_recipients (
  id         bigint generated always as identity primary key,
  shop_id    uuid not null references shops(id) on delete cascade,
  phone      text not null,
  created_at timestamptz not null default now()
);

create index alert_recipients_shop_id_idx on alert_recipients (shop_id);

alter table alert_recipients enable row level security;

-- Same pattern as items: available to Standard and Pro both (this is core
-- inventory management, not a Recipes-tier feature), owner-scoped.
create policy "Shop owners manage their own alert recipients"
  on alert_recipients for all
  using (
    auth.uid() = shop_id
    and exists (
      select 1 from shops
      where shops.id = auth.uid() and shops.tier in ('standard', 'pro')
    )
  )
  with check (
    auth.uid() = shop_id
    and exists (
      select 1 from shops
      where shops.id = auth.uid() and shops.tier in ('standard', 'pro')
    )
  );

-- Admins can view every shop's recipients too, consistent with the rest
-- of the admin panel (view-only, additive, doesn't touch owner access).
create policy "Admins can view all alert recipients"
  on alert_recipients for select
  using (exists (select 1 from admins where admins.id = auth.uid()));
