-- Ground Work — security hardening from the 2026-11-01 audit (SECURITY_AUDIT.md)
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 016_shops_lockdown.sql. Safe to run more than once. Nothing here changes
-- what a normal shop owner can do; it only closes doors the browser could
-- previously reach by talking to the database directly.
--
-- Production data was checked against every constraint below before this was
-- written (longest item name 14 chars, no alert recipients yet, etc.).

-- ---------------------------------------------------------------------------
-- SEC-02  Text alerts: only well-formed US/Canada numbers, no duplicates, at
-- most 5 per shop. Until now any paid account could insert thousands of rows
-- (anyone's number, any country) straight through the REST API.
-- ---------------------------------------------------------------------------
alter table public.alert_recipients drop constraint if exists alert_recipients_e164;
alter table public.alert_recipients
  add constraint alert_recipients_e164 check (phone ~ '^\+1[2-9][0-9]{2}[2-9][0-9]{6}$');

create unique index if not exists alert_recipients_shop_phone_uq
  on public.alert_recipients (shop_id, phone);

create or replace function public.cap_alert_recipients()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.alert_recipients where shop_id = new.shop_id) >= 5 then
    raise exception 'A shop can have at most 5 text-alert recipients.' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists alert_recipients_cap on public.alert_recipients;
create trigger alert_recipients_cap
  before insert on public.alert_recipients
  for each row execute function public.cap_alert_recipients();

-- ---------------------------------------------------------------------------
-- SEC-02 / SEC-13  Length and range limits. Item names and units end up inside
-- text messages, so they are bounded; negative or absurd quantities are
-- rejected (a negative recipe amount would turn a sale into a stock increase).
-- ---------------------------------------------------------------------------
alter table public.items drop constraint if exists items_name_len;
alter table public.items add constraint items_name_len check (char_length(name) between 1 and 80);
alter table public.items drop constraint if exists items_unit_len;
alter table public.items add constraint items_unit_len check (char_length(unit) between 1 and 30);
alter table public.items drop constraint if exists items_ranges;
alter table public.items add constraint items_ranges check (
  count >= 0 and count < 1000000000
  and threshold >= 0 and threshold < 1000000000
  and (unit_size is null or (unit_size > 0 and unit_size < 10000000))
);

alter table public.ingredients drop constraint if exists ingredients_amount_range;
alter table public.ingredients add constraint ingredients_amount_range check (amount >= 0 and amount < 10000000);

alter table public.menu_items drop constraint if exists menu_items_name_len;
alter table public.menu_items add constraint menu_items_name_len check (char_length(name) between 1 and 80);

alter table public.shops drop constraint if exists shops_name_len;
alter table public.shops add constraint shops_name_len check (char_length(name) between 1 and 80);
alter table public.shops drop constraint if exists shops_alert_days_range;
alter table public.shops add constraint shops_alert_days_range check (expiration_alert_days between 1 and 60);

-- New signups: the shop name comes from user-controlled sign-up metadata, so
-- trim and bound it (and never end up empty).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.shops (id, name, tier)
  values (
    new.id,
    coalesce(
      nullif(left(btrim(new.raw_user_meta_data ->> 'shop_name'), 80), ''),
      nullif(left(split_part(new.email, '@', 1), 80), ''),
      'My shop'
    ),
    'none'
  );
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- SEC-15  Tables only the server (service role) should touch. They already have
-- row-level security with no policies; this removes the table privileges too,
-- so one careless future policy can't expose Square tokens or PIN hashes.
-- ---------------------------------------------------------------------------
revoke all on public.square_connections, public.square_orders_seen, public.sales_aliases,
              public.square_unmatched, public.sales_sizes, public.modifier_rules,
              public.shop_owner_pins
  from anon, authenticated;

-- The signed-out role never needs to read any table directly.
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

revoke execute on function public.consume_batches_fifo(bigint, numeric) from public, anon;

-- ---------------------------------------------------------------------------
-- Alert webhook: point at the www host. The bare domain answers with a
-- redirect, which pg_net does not follow for a POST. Same function as in
-- 008_alerts_webhook_trigger.sql with only the URL changed.
-- ---------------------------------------------------------------------------
create or replace function notify_item_updated()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, vault
as $$
declare
  webhook_secret text;
begin
  select decrypted_secret into webhook_secret
  from vault.decrypted_secrets
  where name = 'alerts_webhook_secret';

  perform net.http_post(
    url := 'https://www.groundworksinventory.dev/api/alerts/item-updated',
    body := jsonb_build_object(
      'type', 'UPDATE',
      'table', 'items',
      'record', to_jsonb(NEW),
      'old_record', to_jsonb(OLD)
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-alerts-secret', webhook_secret
    )
  );
  return NEW;
end;
$$;
