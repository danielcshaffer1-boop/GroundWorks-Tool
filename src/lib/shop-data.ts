"use client";

// Data-access layer for items/menu_items/ingredients — every Supabase call
// this app makes against a shop's inventory and recipes lives here, so the
// snake_case (DB) <-> camelCase (app) mapping only happens in one place.
// Every query implicitly runs as the signed-in user via the anon key,
// scoped by the RLS policies in supabase/003_items_menu_ingredients_rls.sql
// — there is no service-role bypass anywhere in this file.

import { createClient } from "@/lib/supabase/client";
import type { Batch, DisplayMode, InventoryItem, MenuItem, ShopSummary, Tier } from "@/lib/types";

// Every shop, not just the signed-in one — only returns rows at all for a
// user in the admins table (supabase/006_admin.sql); anyone else gets an
// empty array back, same as any other RLS-filtered select.
interface ShopSummaryRow {
  id: string;
  name: string;
  tier: Tier;
  created_at: string;
  stripe_subscription_id: string | null;
  subscription_status: string | null;
}

export async function fetchAllShops(): Promise<ShopSummary[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shops")
    .select("id, name, tier, created_at, stripe_subscription_id, subscription_status")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as unknown as ShopSummaryRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    tier: row.tier,
    createdAt: row.created_at,
    stripeSubscriptionId: row.stripe_subscription_id,
    subscriptionStatus: row.subscription_status,
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

// Full-row edit — everything AddItemForm sets at creation, editable
// afterward too. Distinct from updateItemCount/updateItemCounts above,
// which stay narrow (just `count`) since those are the hot paths (Quick
// Log, Closing Count) and don't need the rest of this shape.
export async function updateItem(id: number, item: Omit<InventoryItem, "id">): Promise<InventoryItem> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("items")
    .update({
      name: item.name,
      category: item.category,
      unit: item.unit,
      count: item.count,
      threshold: item.threshold,
      unit_size: item.unitSize,
      unit_measure: item.unitMeasure,
    })
    .eq("id", id)
    .select(ITEM_COLUMNS)
    .single();
  if (error) throw error;
  return fromItemRow(data as unknown as ItemRow);
}

// item_id has ON DELETE RESTRICT on ingredients (see supabase/schema.sql),
// so this throws if the item is still used in a recipe — surfaced to the
// caller as a normal error, not something papered over here.
export async function deleteItemRow(id: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("items").delete().eq("id", id);
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

// Purely cosmetic per-shop preference — see supabase/010_shop_display_mode.sql.
// Unlike tier, ordinary owner UPDATE privileges cover this column fine.
export async function updateDisplayMode(shopId: string, mode: DisplayMode): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("shops").update({ display_mode: mode }).eq("id", shopId);
  if (error) throw error;
}

// There is deliberately no client-side updateShopTier here anymore.
// supabase/005_paid_tiers.sql revokes UPDATE on shops.tier from the
// authenticated role entirely — only the Stripe webhook route, using the
// service-role key server-side, can change it now.

export interface AlertRecipient {
  id: number;
  phone: string;
}

export async function fetchAlertRecipients(shopId: string): Promise<AlertRecipient[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("alert_recipients")
    .select("id, phone")
    .eq("shop_id", shopId)
    .order("id", { ascending: true });
  if (error) throw error;
  return data as unknown as AlertRecipient[];
}

export async function addAlertRecipient(shopId: string, phone: string): Promise<AlertRecipient> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("alert_recipients")
    .insert({ shop_id: shopId, phone })
    .select("id, phone")
    .single();
  if (error) throw error;
  return data as unknown as AlertRecipient;
}

export async function deleteAlertRecipient(id: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("alert_recipients").delete().eq("id", id);
  if (error) throw error;
}

// Same idea as display_mode — a shop-level setting, ordinary owner UPDATE
// privileges cover it. See supabase/011_batches.sql.
export async function updateExpirationAlertDays(shopId: string, days: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("shops").update({ expiration_alert_days: days }).eq("id", shopId);
  if (error) throw error;
}

// ---- Perishable batches (FIFO expiration tracking) ------------------------
// See supabase/011_batches.sql for the full design note. items.count stays
// the source of truth everywhere else in the app; a batch just tracks that
// some portion of it expires on a given date.

interface BatchRow {
  id: number;
  item_id: number;
  quantity: number;
  expires_on: string;
}

function fromBatchRow(row: BatchRow): Batch {
  return { id: row.id, itemId: row.item_id, quantity: row.quantity, expiresOn: row.expires_on };
}

// All of a shop's batches in one query (RLS already scopes this to the
// caller's own shop; the items!inner join + filter is defense-in-depth /
// explicitness, matching the rest of this file's style) rather than one
// request per item.
export async function fetchBatchesForShop(shopId: string): Promise<Batch[]> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("batches")
    .select("id, item_id, quantity, expires_on, items!inner(shop_id)")
    .eq("items.shop_id", shopId)
    .order("expires_on", { ascending: true });
  if (error) throw error;
  return (data as unknown as BatchRow[]).map(fromBatchRow);
}

export async function insertBatch(itemId: number, quantity: number, expiresOn: string): Promise<Batch> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("batches")
    .insert({ item_id: itemId, quantity, expires_on: expiresOn })
    .select("id, item_id, quantity, expires_on")
    .single();
  if (error) throw error;
  return fromBatchRow(data as unknown as BatchRow);
}

export async function updateBatch(
  id: number,
  patch: { quantity?: number; expiresOn?: string }
): Promise<Batch> {
  const supabase = createClient();
  const dbPatch: Record<string, number | string | boolean> = {};
  if (patch.quantity !== undefined) dbPatch.quantity = patch.quantity;
  // A corrected date should re-arm the expiration alert rather than stay
  // silenced by whatever the old date already triggered (or didn't).
  if (patch.expiresOn !== undefined) {
    dbPatch.expires_on = patch.expiresOn;
    dbPatch.expiration_alert_sent = false;
  }
  const { data, error } = await supabase
    .from("batches")
    .update(dbPatch)
    .eq("id", id)
    .select("id, item_id, quantity, expires_on")
    .single();
  if (error) throw error;
  return fromBatchRow(data as unknown as BatchRow);
}

export async function deleteBatchRow(id: number): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase.from("batches").delete().eq("id", id);
  if (error) throw error;
}

// Trims the oldest-expiring batch(es) for an item by `amount`, deleting
// any batch that's fully used up — the actual FIFO logic, run as a single
// atomic Postgres function (consume_batches_fifo) rather than several
// client round trips. No-op if the item has no batches (or amount <= 0);
// callers don't need to check first.
export async function consumeBatchesFIFO(itemId: number, amount: number): Promise<void> {
  if (!(amount > 0)) return;
  const supabase = createClient();
  const { error } = await supabase.rpc("consume_batches_fifo", { p_item_id: itemId, p_amount: amount });
  if (error) throw error;
}
