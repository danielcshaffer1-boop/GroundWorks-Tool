-- Ground Work — restock alert trigger
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 007_restock_alerts.sql has succeeded, AND after running the one-off
-- vault.create_secret() step (see the project notes / chat — that step is
-- deliberately NOT in this file, because this file gets committed to git
-- and the secret shouldn't be).
--
-- The dashboard's Database -> Webhooks page moved/disappeared depending on
-- project version, so this recreates the same mechanism directly: a
-- Postgres trigger on `items` that fires an async HTTP POST via the
-- pg_net extension straight to /api/alerts/item-updated, carrying the
-- same { type, table, record, old_record } shape that route already
-- expects (see src/app/api/alerts/item-updated/route.ts). This is in fact
-- exactly what the dashboard feature does under the hood, just written by
-- hand instead of clicked together.

create extension if not exists pg_net with schema extensions;

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
    url := 'https://groundworksinventory.dev/api/alerts/item-updated',
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

drop trigger if exists items_updated_alert on items;
create trigger items_updated_alert
  after update on items
  for each row
  execute function notify_item_updated();
