-- Ground Work — per-shop display mode (Count vs. Amount toggle)
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 009_menu_item_name_uniqueness.sql has succeeded.
--
-- 'count' shows the raw number of stocking units (e.g. "1.69 bags").
-- 'measurement' shows a converted total (count * unit_size, e.g. "27 oz")
-- for items that have unit_size/unit_measure set. Purely cosmetic — no
-- other column or RLS policy needs to change, since the existing "Shop
-- owners can update their own shop" policy from 002_auth_and_shops_rls.sql
-- already covers any column that isn't explicitly revoked (only
-- tier/stripe_* are — see 005_paid_tiers.sql), so shop owners can flip
-- this themselves through the app with no extra grants needed.

alter table shops
  add column if not exists display_mode text not null default 'count'
  check (display_mode in ('count', 'measurement'));
