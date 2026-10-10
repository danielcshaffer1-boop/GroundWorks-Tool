import type { SupabaseClient } from "@supabase/supabase-js";
import { DEMO_SHOP_ID } from "./demo";

// The public Demo Shop is shared and mutable: every visitor can change counts,
// add items, even add alert phone numbers. A nightly cron (see
// /api/demo/reset) calls resetDemoShop() to put it back exactly as below, so it
// always opens as a believable, mid-shift coffee shop: 2 critical, 3 reorder
// soon, 6 stocked, a few labeled batches, and four working recipes.
//
// Keep this in sync with the screenshots in public/landing/ if the seed's look
// changes, since the landing page shows this same shop.

type Category = "perishable" | "dry" | "disposable";

interface SeedItem {
  key: string;
  name: string;
  unit: string;
  category: Category;
  count: number;
  threshold: number;
  unitSize: number;
  unitMeasure: string;
}

const ITEMS: SeedItem[] = [
  { key: "whole-milk", name: "Whole Milk", unit: "gallon", category: "perishable", count: 1.5, threshold: 4, unitSize: 128, unitMeasure: "oz" },
  { key: "oat-milk", name: "Oat Milk", unit: "carton", category: "perishable", count: 6, threshold: 4, unitSize: 32, unitMeasure: "oz" },
  { key: "half-and-half", name: "Half & Half", unit: "quart", category: "perishable", count: 3, threshold: 3, unitSize: 32, unitMeasure: "oz" },
  { key: "heavy-cream", name: "Heavy Cream", unit: "quart", category: "perishable", count: 5, threshold: 2, unitSize: 32, unitMeasure: "oz" },
  { key: "espresso-beans", name: "Espresso Beans", unit: "5 lb bag", category: "dry", count: 2, threshold: 3, unitSize: 80, unitMeasure: "oz" },
  { key: "vanilla-syrup", name: "Vanilla Syrup", unit: "bottle", category: "dry", count: 6, threshold: 3, unitSize: 25.4, unitMeasure: "oz" },
  { key: "caramel-syrup", name: "Caramel Syrup", unit: "bottle", category: "dry", count: 1, threshold: 3, unitSize: 25.4, unitMeasure: "oz" },
  { key: "matcha", name: "Matcha Powder", unit: "tin", category: "dry", count: 4, threshold: 2, unitSize: 10, unitMeasure: "oz" },
  { key: "cups-12", name: "12 oz Cups", unit: "sleeve", category: "disposable", count: 9, threshold: 4, unitSize: 50, unitMeasure: "cups" },
  { key: "cups-16", name: "16 oz Cups", unit: "sleeve", category: "disposable", count: 3, threshold: 4, unitSize: 50, unitMeasure: "cups" },
  { key: "lids", name: "Lids", unit: "sleeve", category: "disposable", count: 8, threshold: 4, unitSize: 100, unitMeasure: "lids" },
];

// Expiry is relative to the day of the reset, and always beyond the shop's
// 3-day expiration-alert window, so the demo never reads as already expired.
const BATCHES = [
  { item: "whole-milk", quantity: 1, daysOut: 5, label: "Sysco delivery" },
  { item: "whole-milk", quantity: 0.5, daysOut: 12, label: "Walk-in cooler" },
  { item: "half-and-half", quantity: 3, daysOut: 9, label: "Sysco delivery" },
];

const RECIPES = [
  { name: "Espresso Shot", ingredients: [{ item: "espresso-beans", amount: 0.64 }] },
  {
    name: "Vanilla Latte",
    ingredients: [
      { item: "espresso-beans", amount: 0.64 },
      { item: "whole-milk", amount: 8 },
      { item: "vanilla-syrup", amount: 0.5 },
      { item: "cups-12", amount: 1 },
    ],
  },
  {
    name: "Oat Milk Latte",
    ingredients: [
      { item: "espresso-beans", amount: 0.64 },
      { item: "oat-milk", amount: 8 },
      { item: "cups-12", amount: 1 },
    ],
  },
  {
    name: "Matcha Latte",
    ingredients: [
      { item: "matcha", amount: 0.07 },
      { item: "oat-milk", amount: 8 },
      { item: "cups-12", amount: 1 },
    ],
  },
];

function isoDateFromToday(daysOut: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + daysOut);
  return d.toISOString().slice(0, 10);
}

function fail(step: string, error: { message: string }): never {
  throw new Error(`Demo reset failed at "${step}": ${error.message}`);
}

export async function resetDemoShop(supabase: SupabaseClient) {
  // Remember what's there now; the old items are deleted only after the fresh
  // copy exists.
  const [oldItems, oldMenu] = await Promise.all([
    supabase.from("items").select("id").eq("shop_id", DEMO_SHOP_ID),
    supabase.from("menu_items").select("id").eq("shop_id", DEMO_SHOP_ID),
  ]);
  if (oldItems.error) fail("read items", oldItems.error);
  if (oldMenu.error) fail("read menu items", oldMenu.error);
  const oldItemIds = (oldItems.data ?? []).map((r) => r.id as number);
  const oldMenuIds = (oldMenu.data ?? []).map((r) => r.id as number);

  const newItemIds: number[] = [];
  const newMenuIds: number[] = [];

  try {
    const items = await supabase
      .from("items")
      .insert(
        ITEMS.map((i) => ({
          shop_id: DEMO_SHOP_ID,
          name: i.name,
          unit: i.unit,
          category: i.category,
          count: i.count,
          threshold: i.threshold,
          unit_size: i.unitSize,
          unit_measure: i.unitMeasure,
        }))
      )
      .select("id, name");
    if (items.error) fail("insert items", items.error);
    const idByKey = new Map<string, number>();
    for (const row of items.data ?? []) {
      newItemIds.push(row.id as number);
      const seed = ITEMS.find((i) => i.name === row.name);
      if (seed) idByKey.set(seed.key, row.id as number);
    }

    const batches = await supabase.from("batches").insert(
      BATCHES.map((b) => ({
        item_id: idByKey.get(b.item)!,
        quantity: b.quantity,
        expires_on: isoDateFromToday(b.daysOut),
        label: b.label,
      }))
    );
    if (batches.error) fail("insert batches", batches.error);

    // menu_items has a unique index on (shop, lower(name)), so the old recipes
    // must go before same-named new ones can be inserted. (Their ingredient
    // rows cascade, which is also what frees the old items for deletion.)
    if (oldMenuIds.length) {
      const r = await supabase.from("menu_items").delete().in("id", oldMenuIds);
      if (r.error) fail("delete old menu items", r.error);
    }

    const menu = await supabase
      .from("menu_items")
      .insert(RECIPES.map((r) => ({ shop_id: DEMO_SHOP_ID, name: r.name })))
      .select("id, name");
    if (menu.error) fail("insert menu items", menu.error);
    const menuIdByName = new Map<string, number>();
    for (const row of menu.data ?? []) {
      newMenuIds.push(row.id as number);
      menuIdByName.set(row.name as string, row.id as number);
    }

    const ingredients = await supabase.from("ingredients").insert(
      RECIPES.flatMap((r) =>
        r.ingredients.map((ing) => ({
          menu_item_id: menuIdByName.get(r.name)!,
          item_id: idByKey.get(ing.item)!,
          amount: ing.amount,
        }))
      )
    );
    if (ingredients.error) fail("insert ingredients", ingredients.error);
  } catch (err) {
    // Roll back the new rows. The old items are still in place; if the failure
    // came after the old recipes were cleared, the next nightly run restores
    // them (the reset is idempotent, so it can always be re-run).
    if (newMenuIds.length) await supabase.from("menu_items").delete().in("id", newMenuIds);
    if (newItemIds.length) await supabase.from("items").delete().in("id", newItemIds);
    throw err;
  }

  // The fresh copy is complete: remove the old items (their batches cascade).
  // The old recipes were already removed above, so nothing references these
  // items any more (ingredients.item_id is ON DELETE RESTRICT).
  if (oldItemIds.length) {
    const r = await supabase.from("items").delete().in("id", oldItemIds);
    if (r.error) fail("delete old items", r.error);
  }

  // Anything a visitor changed at the shop level, and any phone number they
  // added on the Alerts tab, goes too.
  const recipients = await supabase.from("alert_recipients").delete().eq("shop_id", DEMO_SHOP_ID);
  if (recipients.error) fail("clear alert recipients", recipients.error);
  const shop = await supabase
    .from("shops")
    .update({ display_mode: "count", expiration_alert_days: 3 })
    .eq("id", DEMO_SHOP_ID);
  if (shop.error) fail("reset shop settings", shop.error);

  return {
    items: ITEMS.length,
    batches: BATCHES.length,
    recipes: RECIPES.length,
    removedItems: oldItemIds.length,
    removedMenuItems: oldMenuIds.length,
  };
}
