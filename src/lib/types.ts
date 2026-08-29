// Shared domain types — used by both the client component and the
// Supabase query helpers, so keep this free of any client-only imports.

export type CategoryId = "perishable" | "dry" | "disposable";
export type Status = "good" | "low" | "critical";
// 'none' = signed up but no active paid plan — locked out of the whole
// dashboard, not just Recipes. Only Stripe's webhook can move a shop off
// 'none' (see supabase/005_paid_tiers.sql); there is no free tier anymore.
export type Tier = "none" | "standard" | "pro";
export type Mode = "quick" | "batch";
export type Page = "update" | "spreadsheet" | "recipes" | "alerts";
// How quantities are shown across the dashboard — "count" is the raw
// number of stocking units (e.g. "1.69 bags"); "measurement" converts
// through unitSize/unitMeasure into a total remaining amount (e.g. "27 oz")
// for items that have those set. Purely a display choice — entry and
// editing always happen in native stocking units regardless of this.
export type DisplayMode = "count" | "measurement";

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
  displayMode: DisplayMode;
}

export interface SaleLine {
  menuItem: MenuItem;
  qty: number;
}

// One row in the admin panel's shop list — a trimmed-down ShopProfile plus
// signup date and Stripe subscription state, for every shop, not just the
// signed-in one. subscriptionStatus is Stripe's raw status string (active,
// past_due, canceled, ...) or null if this shop never subscribed at all.
export interface ShopSummary {
  id: string;
  name: string;
  tier: Tier;
  createdAt: string;
  stripeSubscriptionId: string | null;
  subscriptionStatus: string | null;
}
