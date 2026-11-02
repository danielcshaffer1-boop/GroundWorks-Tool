-- Ground Work — text-alert consent: every number must reply YES before alerts start
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 018_alert_send_log.sql. Additive and safe to run more than once: it only
-- adds columns and a log table, and takes away the browser's direct write access
-- to alert_recipients.
--
-- Flow: the owner adds a number in the app -> the server saves it as pending and
-- texts "reply YES to opt in" -> the recipient's YES reply (handled in
-- /api/twilio/inbound) sets confirmed_at. The alert routes only text numbers
-- where confirmed_at is set. These columns are the consent record.
--
-- There were no recipients in production when this was written, so nothing
-- needs backfilling. Any row that did exist would simply wait for a YES.

alter table public.alert_recipients
  add column if not exists added_by             uuid,
  add column if not exists consent_text         text,
  add column if not exists confirmation_sent_at timestamptz,
  add column if not exists confirmation_sends   integer not null default 0,
  add column if not exists confirmed_at         timestamptz,
  add column if not exists confirmed_via        text,
  add column if not exists confirmed_sid        text;

-- Only the server (service role) adds numbers or marks them confirmed. The
-- browser may still read and delete its own shop's rows (RLS unchanged).
revoke insert, update on public.alert_recipients from authenticated, anon;

-- One row per confirmation text sent, kept so the server can limit how often
-- any one number (or shop) can be texted, even if the recipient row is deleted
-- and re-added. Server-only.
create table if not exists public.consent_request_log (
  id      bigint generated always as identity primary key,
  shop_id uuid not null references public.shops(id) on delete cascade,
  phone   text not null,
  sent_at timestamptz not null default now()
);
create index if not exists consent_request_log_phone_idx on public.consent_request_log (phone, sent_at desc);
create index if not exists consent_request_log_shop_idx  on public.consent_request_log (shop_id, sent_at desc);
alter table public.consent_request_log enable row level security;
revoke all on public.consent_request_log from anon, authenticated;
