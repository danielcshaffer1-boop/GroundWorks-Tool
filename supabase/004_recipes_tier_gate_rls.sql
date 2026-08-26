-- Ground Work — server-side Recipes tier gate (step 5 of 6)
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- 003_items_menu_ingredients_rls.sql has succeeded.
--
-- Tightens the existing menu_items/ingredients policies from step 3 to
-- additionally require the shop's own tier = 'pro'. Since RLS conditions
-- are re-evaluated on every query (not cached), a shop that gets switched
-- back to 'basic' loses access to its own recipes immediately — no
-- re-login needed, and no way to see or write menu_items/ingredients by
-- going around the app's UI. `items` is deliberately left alone: every
-- tier keeps its inventory, only Recipes is gated.

alter policy "Shop owners manage their own menu items"
  on menu_items
  using (
    auth.uid() = shop_id
    and exists (
      select 1 from shops
      where shops.id = auth.uid() and shops.tier = 'pro'
    )
  )
  with check (
    auth.uid() = shop_id
    and exists (
      select 1 from shops
      where shops.id = auth.uid() and shops.tier = 'pro'
    )
  );

alter policy "Shop owners manage their own recipe ingredients"
  on ingredients
  using (
    exists (
      select 1 from menu_items
      where menu_items.id = ingredients.menu_item_id
        and menu_items.shop_id = auth.uid()
    )
    and exists (
      select 1 from shops
      where shops.id = auth.uid() and shops.tier = 'pro'
    )
  )
  with check (
    exists (
      select 1 from menu_items
      where menu_items.id = ingredients.menu_item_id
        and menu_items.shop_id = auth.uid()
    )
    and exists (
      select 1 from items
      where items.id = ingredients.item_id
        and items.shop_id = auth.uid()
    )
    and exists (
      select 1 from shops
      where shops.id = auth.uid() and shops.tier = 'pro'
    )
  );
