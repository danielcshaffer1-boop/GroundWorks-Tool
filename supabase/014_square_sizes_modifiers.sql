-- GroundWorks — Square size multipliers and modifier rules (Pro)
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 013_square.sql has succeeded. Safe to run twice.
--
-- Server-only like the other Square tables: RLS on, no policies, reached
-- through the /api/square/* routes with the service role.

-- ---------------------------------------------------------------------
-- sales_sizes — "a Large uses 1.33x the recipe". Shop-wide (most shops use
-- the same sizes across the whole menu), keyed by the normalized Square
-- variation name. Rows appear automatically the first time a size is seen
-- on a sale (multiplier 1, confirmed = false, i.e. "needs setting"), so the
-- owner is shown exactly which sizes exist and nothing is guessed.
-- ---------------------------------------------------------------------
create table if not exists sales_sizes (
  shop_id     uuid not null references shops(id) on delete cascade,
  size_key    text not null,
  label       text not null,
  multiplier  numeric not null default 1 check (multiplier > 0 and multiplier <= 10),
  confirmed   boolean not null default false,
  times_seen  integer not null default 0,
  last_seen   timestamptz not null default now(),
  primary key (shop_id, size_key)
);
alter table sales_sizes enable row level security;

-- ---------------------------------------------------------------------
-- modifier_rules — what a Square modifier does to stock. effects is a JSON
-- array, or null while the owner hasn't set the modifier up yet:
--   []                                              -> deliberately no stock effect
--   [{"type":"add","itemId":12,"amount":0.64}]      -> uses extra of an ingredient
--   [{"type":"swap","fromItemId":3,"toItemId":4}]   -> uses one ingredient instead of another
-- ---------------------------------------------------------------------
create table if not exists modifier_rules (
  shop_id     uuid not null references shops(id) on delete cascade,
  name_key    text not null,
  label       text not null,
  effects     jsonb,
  times_seen  integer not null default 0,
  last_seen   timestamptz not null default now(),
  primary key (shop_id, name_key)
);
alter table modifier_rules enable row level security;

-- ---------------------------------------------------------------------
-- apply_square_sales — same atomic, idempotent function as 013, now also
-- recording each newly-applied order's sizes and modifiers (so they show up
-- for setup). Each order may carry:
--   "sizes":     [ { "key": "...", "label": "..." } ]
--   "modifiers": [ { "key": "...", "label": "..." } ]
-- ---------------------------------------------------------------------
create or replace function apply_square_sales(p_shop_id uuid, p_orders jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  o jsonb;
  d record;
  u jsonb;
  totals jsonb := '{}'::jsonb;
  applied integer := 0;
  inserted integer;
begin
  perform pg_advisory_xact_lock(hashtext('square_sales:' || p_shop_id::text));

  for o in select * from jsonb_array_elements(p_orders) loop
    insert into square_orders_seen (shop_id, order_id)
      values (p_shop_id, o->>'id')
      on conflict do nothing;
    get diagnostics inserted = row_count;
    if inserted = 0 then
      continue;
    end if;
    applied := applied + 1;

    for d in select key, value::numeric as amt from jsonb_each_text(coalesce(o->'deltas', '{}'::jsonb)) loop
      totals := jsonb_set(
        totals, array[d.key],
        to_jsonb(coalesce((totals->>d.key)::numeric, 0) + d.amt)
      );
    end loop;

    for u in select * from jsonb_array_elements(coalesce(o->'unmatched', '[]'::jsonb)) loop
      insert into square_unmatched (shop_id, name_key, name, variation, qty, last_seen)
        values (p_shop_id, u->>'key', u->>'name', nullif(u->>'variation', ''), (u->>'qty')::numeric, now())
        on conflict (shop_id, name_key)
        do update set qty = square_unmatched.qty + excluded.qty, last_seen = now();
    end loop;

    for u in select * from jsonb_array_elements(coalesce(o->'sizes', '[]'::jsonb)) loop
      insert into sales_sizes (shop_id, size_key, label, times_seen, last_seen)
        values (p_shop_id, u->>'key', u->>'label', 1, now())
        on conflict (shop_id, size_key)
        do update set times_seen = sales_sizes.times_seen + 1, last_seen = now();
    end loop;

    for u in select * from jsonb_array_elements(coalesce(o->'modifiers', '[]'::jsonb)) loop
      insert into modifier_rules (shop_id, name_key, label, times_seen, last_seen)
        values (p_shop_id, u->>'key', u->>'label', 1, now())
        on conflict (shop_id, name_key)
        do update set times_seen = modifier_rules.times_seen + 1, last_seen = now();
    end loop;
  end loop;

  for d in select key::bigint as item_id, value::numeric as amt from jsonb_each_text(totals) loop
    if d.amt > 0 then
      update items
        set count = greatest(0, round(count - d.amt, 4))
        where id = d.item_id and shop_id = p_shop_id;
      perform consume_batches_fifo(d.item_id, d.amt);
    end if;
  end loop;

  return applied;
end;
$$;

revoke execute on function apply_square_sales(uuid, jsonb) from public, anon, authenticated;
grant execute on function apply_square_sales(uuid, jsonb) to service_role;
