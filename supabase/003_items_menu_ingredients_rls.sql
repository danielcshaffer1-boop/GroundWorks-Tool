-- Ground Work — RLS for items, menu_items, ingredients (step 3 of 6)
-- Run in Supabase Dashboard -> SQL Editor, in a fresh query tab, AFTER
-- schema.sql and 002_auth_and_shops_rls.sql have both succeeded.
--
-- `for all` covers select/insert/update/delete in one policy: `using`
-- gates which existing rows you can see/touch, `with check` gates what
-- values you're allowed to write.

-- ---------------------------------------------------------------------
-- items — shop_id is a direct column, so this is a plain ownership check.
-- ---------------------------------------------------------------------
create policy "Shop owners manage their own items"
  on items for all
  using (auth.uid() = shop_id)
  with check (auth.uid() = shop_id);

-- ---------------------------------------------------------------------
-- menu_items — same pattern, shop_id is direct here too.
-- ---------------------------------------------------------------------
create policy "Shop owners manage their own menu items"
  on menu_items for all
  using (auth.uid() = shop_id)
  with check (auth.uid() = shop_id);

-- ---------------------------------------------------------------------
-- ingredients — no shop_id column, so ownership is established by joining
-- up to menu_items. The with check goes a step further and also verifies
-- item_id belongs to the same shop, not just menu_item_id: without that,
-- a shop could point one of their own recipe lines at another shop's
-- inventory item by guessing its id (ids are sequential, easy to guess).
-- That's exactly the "even if they guess an ID" case from the brief.
-- ---------------------------------------------------------------------
create policy "Shop owners manage their own recipe ingredients"
  on ingredients for all
  using (
    exists (
      select 1 from menu_items
      where menu_items.id = ingredients.menu_item_id
        and menu_items.shop_id = auth.uid()
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
  );
