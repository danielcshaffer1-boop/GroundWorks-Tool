-- Ground Work — perishable batches, FIFO consumption, expiration alerts
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 010_shop_display_mode.sql has succeeded.

-- ---------------------------------------------------------------------
-- batches — one row per batch of a perishable item. Deliberately NOT the
-- sole source of truth for how much you have: items.count stays that (so
-- nothing that already reads count — status, thresholds, restock alerts,
-- recipes — needs to change). A batch just tracks that some portion of
-- the count expires on a given date. Adding a batch bumps count and
-- inserts a row together; consuming (Quick Log, Closing Count, a sales
-- deduction) decrements count as it always has AND separately trims the
-- oldest-expiring batch(es) by the same amount via consume_batches_fifo
-- below, falling through to untracked stock once batches run out.
-- ---------------------------------------------------------------------
create table batches (
  id                     bigint generated always as identity primary key,
  item_id                bigint not null references items(id) on delete cascade,
  quantity               numeric not null check (quantity >= 0),
  expires_on             date not null,
  -- Sent = true once the expiration text has gone out for this batch, so
  -- the daily check (see the /api/alerts/expiring-batches route) doesn't
  -- re-text every day the batch sits inside the alert window. Reset to
  -- false whenever expires_on is edited, so a corrected date re-evaluates.
  expiration_alert_sent  boolean not null default false,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

create index batches_item_id_idx on batches (item_id);
create index batches_expires_on_idx on batches (expires_on);

create trigger batches_set_updated_at before update on batches
  for each row execute function set_updated_at();

alter table batches enable row level security;

-- Same ownership pattern as items/alert_recipients: owner-scoped through
-- item_id -> items.shop_id, gated to an active paid plan (batches are
-- core inventory management, same as items — not a Recipes/Pro-only
-- feature).
create policy "Shop owners manage their own batches"
  on batches for all
  using (
    exists (
      select 1 from items
      join shops on shops.id = items.shop_id
      where items.id = batches.item_id
        and shops.id = auth.uid()
        and shops.tier in ('standard', 'pro')
    )
  )
  with check (
    exists (
      select 1 from items
      join shops on shops.id = items.shop_id
      where items.id = batches.item_id
        and shops.id = auth.uid()
        and shops.tier in ('standard', 'pro')
    )
  );

create policy "Admins can view all batches"
  on batches for select
  using (exists (select 1 from admins where admins.id = auth.uid()));

-- ---------------------------------------------------------------------
-- consume_batches_fifo — the actual FIFO logic, as a single-round-trip,
-- atomic Postgres function rather than several client round trips (which
-- could partially fail between an update and a delete). security invoker
-- (the default) means it runs as whichever user calls it, so the RLS
-- policy above still applies to every select/update/delete inside it —
-- calling this against an item_id you don't own just finds zero batch
-- rows and does nothing, no separate ownership check needed here.
-- ---------------------------------------------------------------------
create function consume_batches_fifo(p_item_id bigint, p_amount numeric)
returns void
language plpgsql
as $$
declare
  remaining numeric := p_amount;
  b record;
begin
  if p_amount is null or p_amount <= 0 then
    return;
  end if;

  for b in
    select id, quantity from batches
    where item_id = p_item_id
    order by expires_on asc
    for update
  loop
    exit when remaining <= 0;
    if b.quantity <= remaining then
      remaining := remaining - b.quantity;
      delete from batches where id = b.id;
    else
      update batches set quantity = b.quantity - remaining where id = b.id;
      remaining := 0;
    end if;
  end loop;
end;
$$;

grant execute on function consume_batches_fifo(bigint, numeric) to authenticated;

-- ---------------------------------------------------------------------
-- Per-shop expiration alert lead time, editable from the Alerts tab —
-- same idea as the restock threshold living on each item. Ordinary owner
-- UPDATE privileges already cover this column, same as display_mode.
-- ---------------------------------------------------------------------
alter table shops
  add column if not exists expiration_alert_days integer not null default 3
  check (expiration_alert_days > 0);
