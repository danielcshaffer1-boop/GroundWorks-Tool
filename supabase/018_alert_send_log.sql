-- Ground Work — text-alert send log (cooldown and daily cap)
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 017_security_hardening.sql. Safe to run more than once.
--
-- One row per restock text sent for an item. /api/alerts/item-updated reads it
-- to (1) skip a repeat of the same status for an item within a couple of hours
-- (an item bouncing around its threshold shouldn't text every time) and (2) cap
-- how many alert events one shop can trigger per day, so a bug or abuse can't
-- turn into a flood of texts. Only the server (service role) touches it.

create table if not exists public.alert_send_log (
  id      bigint generated always as identity primary key,
  shop_id uuid   not null references public.shops(id)  on delete cascade,
  item_id bigint not null references public.items(id)  on delete cascade,
  status  text   not null check (status in ('low', 'critical')),
  sent_at timestamptz not null default now()
);

create index if not exists alert_send_log_item_idx on public.alert_send_log (item_id, sent_at desc);
create index if not exists alert_send_log_shop_idx on public.alert_send_log (shop_id, sent_at desc);

alter table public.alert_send_log enable row level security;
revoke all on public.alert_send_log from anon, authenticated;
