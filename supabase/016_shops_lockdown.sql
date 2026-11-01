-- Ground Work — close the "any signed-in user can edit their own tier" hole
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab.
-- Safe to run more than once.
--
-- Why this exists: 005_paid_tiers.sql tried to stop shop owners writing
-- tier / stripe_customer_id / stripe_subscription_id / subscription_status with a
-- column-level REVOKE. In Postgres that does nothing when the role already
-- holds a table-wide UPDATE grant, and Supabase gives `authenticated` exactly
-- that on every table it creates. So any signed-in user could PATCH their own
-- shops row and set tier = 'pro' (verified against production on 2026-11-01).
--
-- The fix has two layers, so a future grant mistake can't reopen it:
--   1. take the table-wide grant away and give back only the two columns the
--      app really lets a shop owner change;
--   2. a trigger that refuses changes to the billing columns from the browser
--      roles no matter what the grants say.
-- The service role (Stripe webhook, admin set-tier, demo reset) and the SQL
-- editor are not affected by either layer.

-- 1. Grants
revoke update on public.shops from authenticated, anon;
grant  update (display_mode, expiration_alert_days) on public.shops to authenticated;
revoke insert, delete, truncate on public.shops from authenticated, anon;

-- 2. Trigger (must stay SECURITY INVOKER so current_user is the caller's role)
create or replace function public.shops_protect_columns()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('authenticated', 'anon') and (
        new.id                     is distinct from old.id
     or new.tier                   is distinct from old.tier
     or new.stripe_customer_id     is distinct from old.stripe_customer_id
     or new.stripe_subscription_id is distinct from old.stripe_subscription_id
     or new.subscription_status    is distinct from old.subscription_status) then
    raise exception 'protected column' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists shops_protect_columns on public.shops;
create trigger shops_protect_columns
  before update on public.shops
  for each row execute function public.shops_protect_columns();
