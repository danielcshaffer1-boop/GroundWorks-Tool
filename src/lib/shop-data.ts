"use client";

// Data-access layer for items/menu_items/ingredients — every Supabase call
// this app makes against a shop's inventory and recipes lives here, so the
// snake_case (DB) <-> camelCase (app) mapping only happens in one place.
// Every query implicitly runs as the signed-in user via the anon key,
// scoped by the RLS policies in supabase/003_items_menu_ingredients_rls.sql
// — there is no service-role bypass anywhere in this file.

import { createClient } from "@/lib/supabase/client";
import type { InventoryItem, MenuItem, ShopSummary, Tier } from "@/lib/types";

// Every shop, not just the signed-in one — only returns rows at all for a
// user in the admins table (supabase/006_admin.sql); anyone else gets an
// empty array back, same as any other RLS-filtered select.
export async function fetchAllShops(): Promise<ShopSummary[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shops")
    .select("id, name, tier, created_at")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as { id: string; name: string; tier: Tier; created_at: string }[]).map((row) => ({
    id: row.id,
    name: row.name,
    tier: row.tier,
    createdAt: row.created_at,
  }));
}

interface ItemRow {
  id: number;
  name: string;
  category: InventoryItem["category"];
  unit: string;
  count: number;
  threshold: number;
  unit_size: number | null;
  unit_measure: string | null;
}

const ITEM_COLUMNS = "id, name, category, unit, count, threshold, unit_size, unit_measure";

function fromItemRow(row: ItemRow): InventoryItem {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    unit: row.unit,
    count: row.count,
    threshold: row.threshold,
    unitSize: row.unit_size,
    unitMeasure: row.unit_measure,
  };
}

export async function fetchItems(shopId: string): Promise<InventoryItem[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("items")
    .select(ITEM_COLUMNS)
    .eq("shop_id", shopId)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data as unknown as ItemRow[]).map(fromItemRow);
}

export async function insertItem(shopId: string, item: Omit<InventoryItem, "id">): Promise<InventoryItem> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("items")
    .insert({
      shop_id: shopId,
      name: item.name,
      category: item.category,
      unit: item.unit,
      count: item.count,
      threshold: item.threshold,
      unit_size: item.unitSize,
      unit_measure: item.unitMeasure,
    })
    .select(ITEM_COLUMNS)
    .single();
  if (error) throw error;
  return fromItemRow(data as unknown as ItemRow);
}

export async function updateItemCount(id: number, count: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("items").update({ count }).eq("id", id);
  if (error) throw error;
}

// One request per row rather than a single upsert — items are edited a
// handful at a time (closing count, a sales import), never in bulk enough
// for that to matter, and per-row update() avoids upsert's requirement to
// supply every not-null column just to change `count`.
export async function updateItemCounts(updates: { id: number; count: number }[]): Promise<void> {
  if (updates.length === 0) return;
  const supabase = createClient();
  const results = await Promise.all(
    updates.map(({ id, count }) => supabase.from("items").update({ count }).eq("id", id))
  );
  const failed = results.find((r) => r.error);
  if (failed?.error) throw failed.error;
}

interface IngredientRow {
  id: number;
  item_id: number;
  amount: number;
}

interface MenuItemRow {
  id: number;
  name: string;
  ingredients: IngredientRow[];
}

function fromMenuItemRow(row: MenuItemRow): MenuItem {
  return {
    id: row.id,
    name: row.name,
    ingredients: row.ingredients.map((ing) => ({ id: ing.id, itemId: ing.item_id, amount: ing.amount })),
  };
}

export async function fetchMenuItems(shopId: string): Promise<MenuItem[]> {
  const supabase = createClient();
  // Embedded resource select — PostgREST follows the ingredients.menu_item_id
  // foreign key automatically and nests the matching rows.
  const { data, error } = await supabase
    .from("menu_items")
    .select("id, name, ingredients(id, item_id, amount)")
    .eq("shop_id", shopId)
    .order("id", { ascending: true });
  if (error) throw error;
  return (data as unknown as MenuItemRow[]).map(fromMenuItemRow);
}

export async function insertMenuItem(
  shopId: string,
  name: string,
  firstIngredient: { itemId: number; amount: number }
): Promise<MenuItem> {
  const supabase = createClient();
  const { data: menuItemRow, error: menuItemError } = await supabase
    .from("menu_items")
    .insert({ shop_id: shopId, name })
    .select("id, name")
    .single();
  if (menuItemError) throw menuItemError;

  const { data: ingredientRow, error: ingredientError } = await supabase
    .from("ingredients")
    .insert({
      menu_item_id: menuItemRow.id,
      item_id: firstIngredient.itemId,
      amount: firstIngredient.amount,
    })
    .select("id, item_id, amount")
    .single();
  if (ingredientError) throw ingredientError;

  return {
    id: menuItemRow.id,
    name: menuItemRow.name,
    ingredients: [{ id: ingredientRow.id, itemId: ingredientRow.item_id, amount: ingredientRow.amount }],
  };
}

export async function deleteMenuItemRow(id: number): Promise<void> {
  const supabase = createClient();
  // ingredients.menu_item_id cascades, so this takes the recipe's
  // ingredient rows with it.
  const { error } = await supabase.from("menu_items").delete().eq("id", id);
  if (error) throw error;
}

export async function insertIngredient(
  menuItemId: number,
  itemId: number,
  amount: number
): Promise<{ id: number; itemId: number; amount: number }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("ingredients")
    .insert({ menu_item_id: menuItemId, item_id: itemId, amount })
    .select("id, item_id, amount")
    .single();
  if (error) throw error;
  return { id: data.id, itemId: data.item_id, amount: data.amount };
}

export async function updateIngredient(
  id: number,
  patch: { itemId?: number; amount?: number }
): Promise<void> {
  const supabase = createClient();
  const dbPatch: Record<string, number> = {};
  if (patch.itemId !== undefined) dbPatch.item_id = patch.itemId;
  if (patch.amount !== undefined) dbPatch.amount = patch.amount;
  const { error } = await supabase.from("ingredients").update(dbPatch).eq("id", id);
  if (error) throw error;
}

export async function deleteIngredientRow(id: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("ingredients").delete().eq("id", id);
  if (error) throw error;
}

// There is deliberately no client-side updateShopTier here anymore.
// supabase/005_paid_tiers.sql revokes UPDATE on shops.tier from the
// authenticated role entirely — only the Stripe webhook route, using the
// service-role key server-side, can change it now.
