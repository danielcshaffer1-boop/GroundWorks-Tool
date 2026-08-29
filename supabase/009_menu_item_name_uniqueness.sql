-- Ground Work — recipe (menu item) name uniqueness
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 008_alerts_webhook_trigger.sql has succeeded.
--
-- The app already blocks an exact-duplicate recipe name client-side (see
-- AddMenuItemForm in InventoryTracker.tsx), but that's just UX — nothing
-- stopped it at the database, and nothing caught the case-insensitive
-- version ("Vanilla Latte" vs "vanilla latte") at all. This index is the
-- real enforcement: unique per shop, comparing lower(name), so both cases
-- of duplicate are now impossible regardless of what any client sends.
--
-- If a shop already has duplicate/near-duplicate recipe names sitting in
-- the table, this will fail to create — rename or delete the extras first.

create unique index menu_items_shop_id_lower_name_idx
  on menu_items (shop_id, lower(name));
