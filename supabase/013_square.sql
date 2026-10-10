-- GroundWorks — Square connection (Pro): automatic sales deduction
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 012_batch_labels.sql has succeeded.
--
-- Every table here is reached ONLY by the server (service role), through the
-- /api/square/* routes. RLS is enabled with no policies on purpose: a signed-in
-- browser can read none of it, which matters most for square_connections
-- (it holds the seller's OAuth tokens).

-- ---------------------------------------------------------------------
-- square_connections — one per shop. Tokens are stored encrypted by the app
-- (AES-256-GCM, key in SQUARE_TOKEN_ENC_KEY), never in plain text.
-- sync_from is the moment the seller connected: only sales closed after it
-- are ever deducted, so connecting never back-deducts history.
-- ---------------------------------------------------------------------
create table square_connections (
  shop_id            uuid primary key references shops(id) on delete cascade,
  merchant_id        text not null,
  access_token_enc   text not null,
  refresh_token_enc  text not null,
  expires_at         timestamptz not null,
  location_ids       text[] not null default '{}',
  sync_from          timestamptz not null default now(),
  last_synced_at     timestamptz,
  -- 'active', or 'needs_reconnect' once Square rejects the token (the seller
  -- revoked access) — the UI then asks them to reconnect.
  status             text not null default 'active'
                       check (status in ('active', 'needs_reconnect')),
  last_error         text,
  created_at         timestamptz not null default now()
);
alter table square_connections enable row level security;

-- ---------------------------------------------------------------------
-- square_orders_seen — every Square order already counted, so a re-sync (the
-- sync deliberately looks back a few days to catch offline-sent orders) can
-- never deduct the same sale twice.
-- ---------------------------------------------------------------------
create table square_orders_seen (
  shop_id       uuid not null references shops(id) on delete cascade,
  order_id      text not null,
  processed_at  timestamptz not null default now(),
  primary key (shop_id, order_id)
);
create index square_orders_seen_processed_idx on square_orders_seen (processed_at);
alter table square_orders_seen enable row level security;

-- ---------------------------------------------------------------------
-- sales_aliases — "this POS item name means that recipe", remembered per
-- shop. Server-side so automatic syncs can use it (the manual CSV import
-- keeps its own per-browser copy).
-- ---------------------------------------------------------------------
create table sales_aliases (
  shop_id       uuid not null references shops(id) on delete cascade,
  name_key      text not null,
  menu_item_id  bigint not null references menu_items(id) on delete cascade,
  primary key (shop_id, name_key)
);
alter table sales_aliases enable row level security;

-- ---------------------------------------------------------------------
-- square_unmatched — sold items that matched no recipe, with how many were
-- sold since they were first seen, so the owner can map or create a recipe.
-- ---------------------------------------------------------------------
create table square_unmatched (
  shop_id     uuid not null references shops(id) on delete cascade,
  name_key    text not null,
  name        text not null,
  variation   text,
  qty         numeric not null default 0,
  last_seen   timestamptz not null default now(),
  primary key (shop_id, name_key)
);
alter table square_unmatched enable row level security;

-- ---------------------------------------------------------------------
-- apply_square_sales — applies a batch of already-priced orders atomically
-- and idempotently. p_orders is a JSON array of
--   { "id": "<square order id>",
--     "deltas": { "<item id>": <stocking units used>, ... },
--     "unmatched": [ { "key": "...", "name": "...", "variation": "...", "qty": n } ] }
-- Under a per-shop advisory lock (so a cron run and a "Sync now" click can't
-- interleave), orders already in square_orders_seen are skipped; the rest
-- have their deltas summed so each item is updated ONCE (one stock-alert
-- evaluation, no rounding drift across many tiny per-order amounts), and the
-- oldest-expiring batches are trimmed the same amount, like every other
-- deduction in the app. Returns how many orders were newly applied.
-- ---------------------------------------------------------------------
create function apply_square_sales(p_shop_id uuid, p_orders jsonb)
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

-- Server-only: nobody signed in to the app may call this directly.
revoke execute on function apply_square_sales(uuid, jsonb) from public, anon, authenticated;
grant execute on function apply_square_sales(uuid, jsonb) to service_role;
