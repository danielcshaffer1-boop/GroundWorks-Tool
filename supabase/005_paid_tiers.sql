-- Ground Work — move to a paid-only tier model (prep for Stripe billing)
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 004_recipes_tier_gate_rls.sql has succeeded.
--
-- What changes:
--   tier goes from ('basic' | 'pro'), free by default, to
--   ('none' | 'standard' | 'pro'), locked-out by default — a shop only
--   gets 'standard' or 'pro' once Stripe confirms payment.
--   'basic' is renamed to 'standard' to match the real plan name.
--
-- IMPORTANT: after this runs, brand-new signups will be created with
-- tier='none' and have NO way to become 'standard'/'pro' from inside the
-- app yet — that only happens once the Stripe checkout + webhook (later
-- steps) exist. Our two existing test shops are already tier='pro' and
-- are unaffected; this only matters for anyone who signs up between now
-- and when the checkout flow is live.

-- Existing rows: fold the old free 'basic' into the new no-access 'none'
-- before the stricter constraint below would reject it.
update shops set tier = 'none' where tier = 'basic';

alter table shops drop constraint if exists shops_tier_check;
alter table shops alter column tier set default 'none';
alter table shops add constraint shops_tier_check check (tier in ('none', 'standard', 'pro'));

-- Stripe linkage. subscription_status keeps the raw Stripe status
-- (active, past_due, canceled, ...) for reference/display — it's `tier`
-- that actually drives access, decided by the webhook handler's logic.
alter table shops add column if not exists stripe_customer_id text;
alter table shops add column if not exists stripe_subscription_id text;
alter table shops add column if not exists subscription_status text;

-- The important part: shop owners can still update their own shops row
-- (the existing "Shop owners can update their own shop" RLS policy from
-- step 2 is unchanged, row-level), but can no longer write these specific
-- columns at all, at the SQL privilege level — RLS wouldn't stop this on
-- its own since it only filters rows, not columns. Only the service_role
-- key (used exclusively by the Stripe webhook route, never sent to the
-- browser) bypasses this and can actually set them.
revoke update (tier, stripe_customer_id, stripe_subscription_id, subscription_status)
  on shops from authenticated;

-- New signups start locked out, not on the old free tier.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.shops (id, name, tier)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'shop_name', split_part(new.email, '@', 1)),
    'none'
  );
  return new;
end;
$$;

-- items previously had no tier check at all (Basic's whole value was free
-- inventory tracking). Now every table needs an active paid plan —
-- 'standard' or 'pro' both qualify for items; only 'pro' qualifies for
-- menu_items/ingredients (unchanged from 004).
alter policy "Shop owners manage their own items"
  on items
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
