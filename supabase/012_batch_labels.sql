-- Ground Work — optional batch labels
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 011_batches.sql has succeeded.

-- ---------------------------------------------------------------------
-- Free-text label so a shop can tell batches of the same item apart at a
-- glance — a delivery, a vendor, a lot number, "walk-in" vs "front case" —
-- beyond just quantity + expiration date. Optional: a batch with no label
-- displays and behaves exactly as it did before this migration. Length
-- capped short since it's shown inline next to quantity/date in the batch
-- editor and folded into the expiration-alert text.
-- ---------------------------------------------------------------------
alter table batches
  add column if not exists label text check (char_length(label) <= 60);
