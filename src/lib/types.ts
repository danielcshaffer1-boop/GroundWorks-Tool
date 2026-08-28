// Shared domain types — used by both the client component and the
// Supabase query helpers, so keep this free of any client-only imports.

export type CategoryId = "perishable" | "dry" | "disposable";
export type Status = "good" | "low" | "critical";
// 'none' = signed up but no active paid plan — locked out of the whole
// dashboard, not just Recipes. Only Stripe's webhook can move a shop off
// 'none' (see supabase/005_paid_tiers.sql); there is no free tier anymore.
export type Tier = "none" | "standard" | "pro";
export type Mode = "quick" | "batch";
export type Page = "update" | "spreadsheet" | "recipes";

export interface InventoryItem {
  id: number;
  name: string;
  unit: string;
  count: number;
  threshold: number;
  category: CategoryId;
  unitSize: number | null;
  unitMeasure: string | null;
}

export interface Ingredient {
  id: number;
  itemId: number;
  amount: number;
}

export interface MenuItem {
  id: number;
  name: string;
  ingredients: Ingredient[];
}

// A signed-in shop, as read back from the `shops` table (id == the Supabase
// Auth user id — see supabase/schema.sql). The actual session/credentials
// live in Supabase Auth's own cookie-backed session, not in this object.
export interface ShopProfile {
  id: string;
  name: string;
  tier: Tier;
}

export interface SaleLine {
  menuItem: MenuItem;
  qty: number;
}

// One row in the admin panel's shop list — a trimmed-down ShopProfile plus
// signup date, for every shop, not just the signed-in one.
export interface ShopSummary {
  id: string;
  name: string;
  tier: Tier;
  createdAt: string;
}
