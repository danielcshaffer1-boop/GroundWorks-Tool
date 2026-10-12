import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { InventoryItem, MenuItem, SaleLine } from "./types";
import { buildRow, computeDeductions, matchRecipe, normalizeName, type ParsedRow } from "./sales-import";

// Square connection (Pro): the seller authorizes GroundWorks once through
// Square's OAuth; a scheduled sync then reads their completed orders and
// deducts recipe ingredients, the same math as the CSV import, but with no
// file. Server-only (tokens, client secret). Docs: developer.squareup.com.

// Pinned so a Square API change can never silently alter what we parse.
const SQUARE_VERSION = "2025-01-23";

// The sync looks back this far from its last run, because orders rung up
// offline can reach Square up to 72 hours late. Already-counted orders are
// recognized by id and skipped, so overlapping windows are harmless.
const LOOKBACK_MS = 4 * 24 * 60 * 60 * 1000;
const MAX_PAGES = 20; // 20 x 500 orders per location group, per run
const REFRESH_WITHIN_MS = 7 * 24 * 60 * 60 * 1000;

const SCOPES = ["ORDERS_READ", "MERCHANT_PROFILE_READ"];

// ---- Configuration ---------------------------------------------------------

export function squareBase(): string {
  return process.env.SQUARE_ENVIRONMENT === "production"
    ? "https://connect.squareup.com"
    : "https://connect.squareupsandbox.com";
}

export function squareConfigured(): boolean {
  return Boolean(
    process.env.SQUARE_APPLICATION_ID && process.env.SQUARE_APPLICATION_SECRET && process.env.SQUARE_TOKEN_ENC_KEY
  );
}

function config() {
  const appId = process.env.SQUARE_APPLICATION_ID;
  const secret = process.env.SQUARE_APPLICATION_SECRET;
  if (!appId || !secret || !process.env.SQUARE_TOKEN_ENC_KEY) throw new Error("Square isn't configured.");
  return { appId, secret };
}

// ---- Token encryption (AES-256-GCM) ---------------------------------------

function encKey(): Buffer {
  const key = Buffer.from(process.env.SQUARE_TOKEN_ENC_KEY ?? "", "base64");
  if (key.length !== 32) throw new Error("SQUARE_TOKEN_ENC_KEY must be 32 bytes, base64-encoded.");
  return key;
}

export function encryptToken(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encKey(), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}

export function decryptToken(blob: string): string {
  const [iv, tag, body] = blob.split(".").map((p) => Buffer.from(p, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", encKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

// ---- Square HTTP -----------------------------------------------------------

export class SquareError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string | null
  ) {
    super(message);
  }
  // The seller revoked access, or the token is otherwise no longer valid.
  get isAuthFailure(): boolean {
    return (
      this.status === 401 ||
      this.code === "UNAUTHORIZED" ||
      this.code === "ACCESS_TOKEN_REVOKED" ||
      this.code === "INVALID_GRANT"
    );
  }
}

async function squareFetch<T>(path: string, init: { token?: string; method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`${squareBase()}${path}`, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    headers: {
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
      ...(init.token ? { Authorization: `Bearer ${init.token}` } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { errors?: { code?: string; detail?: string }[] };
  if (!res.ok) {
    const first = json.errors?.[0];
    throw new SquareError(first?.detail ?? `Square returned ${res.status}.`, res.status, first?.code ?? null);
  }
  return json as T;
}

// ---- OAuth -----------------------------------------------------------------

export function buildAuthorizeUrl(state: string, redirectUri: string): string {
  const { appId } = config();
  const params = new URLSearchParams({
    client_id: appId,
    scope: SCOPES.join(" "),
    state,
    redirect_uri: redirectUri,
  });
  // session=false makes Square ask the seller to log in every time (right for a
  // shared computer); Square's sandbox does not support it.
  if (process.env.SQUARE_ENVIRONMENT === "production") params.set("session", "false");
  return `${squareBase()}/oauth2/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_at: string;
  merchant_id: string;
}

export function exchangeCode(code: string, redirectUri: string): Promise<TokenResponse> {
  const { appId, secret } = config();
  return squareFetch<TokenResponse>("/oauth2/token", {
    body: { client_id: appId, client_secret: secret, code, grant_type: "authorization_code", redirect_uri: redirectUri },
  });
}

function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const { appId, secret } = config();
  return squareFetch<TokenResponse>("/oauth2/token", {
    body: { client_id: appId, client_secret: secret, grant_type: "refresh_token", refresh_token: refreshToken },
  });
}

// Tells Square the seller disconnected, so the app disappears from their
// Square "authorized apps" list. Best effort: a failure must not block them
// from disconnecting on our side.
export async function revokeAccess(accessToken: string): Promise<void> {
  const { appId, secret } = config();
  await fetch(`${squareBase()}/oauth2/revoke`, {
    method: "POST",
    headers: {
      "Square-Version": SQUARE_VERSION,
      "Content-Type": "application/json",
      Authorization: `Client ${secret}`,
    },
    body: JSON.stringify({ client_id: appId, access_token: accessToken }),
  }).catch(() => {});
}

// ---- Orders ----------------------------------------------------------------

interface SquareLocation {
  id: string;
  status?: string;
}
export async function listActiveLocationIds(token: string): Promise<string[]> {
  const { locations } = await squareFetch<{ locations?: SquareLocation[] }>("/v2/locations", { token });
  return (locations ?? []).filter((l) => (l.status ?? "ACTIVE") === "ACTIVE").map((l) => l.id);
}

export interface SquareLineItem {
  name?: string;
  variation_name?: string;
  quantity?: string;
  item_type?: string;
  modifiers?: { name?: string; quantity?: string }[];
}
export interface SquareOrder {
  id: string;
  closed_at?: string;
  line_items?: SquareLineItem[];
}

async function searchClosedOrders(token: string, locationIds: string[], since: Date): Promise<SquareOrder[]> {
  const orders: SquareOrder[] = [];
  // The API accepts at most 10 locations per request.
  for (let i = 0; i < locationIds.length; i += 10) {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res = await squareFetch<{ orders?: SquareOrder[]; cursor?: string }>("/v2/orders/search", {
        token,
        body: {
          location_ids: locationIds.slice(i, i + 10),
          limit: 500,
          cursor,
          query: {
            filter: {
              state_filter: { states: ["COMPLETED"] },
              date_time_filter: { closed_at: { start_at: since.toISOString() } },
            },
            sort: { sort_field: "CLOSED_AT", sort_order: "ASC" },
          },
        },
      });
      orders.push(...(res.orders ?? []));
      cursor = res.cursor;
      if (!cursor) break;
    }
  }
  return orders;
}

// ---- Turning orders into stock changes (pure, unit-tested) -----------------

export type ModifierEffect =
  | { type: "add"; itemId: number; amount: number }
  | { type: "swap"; fromItemId: number; toItemId: number };

// The owner's setup, keyed by normalized Square name: size multipliers, and
// modifier rules (null = seen but not set up yet, [] = deliberately no effect).
export interface PricingConfig {
  sizes: Record<string, number>;
  rules: Record<string, ModifierEffect[] | null>;
}

export interface PricedOrder {
  id: string;
  deltas: Record<number, number>; // inventory item id -> stocking units used
  unmatched: { key: string; name: string; variation: string | null; qty: number }[];
  // Sizes and modifiers seen on lines that matched a recipe, so the owner can
  // be shown them for setup.
  sizes: { key: string; label: string }[];
  modifiers: { key: string; label: string }[];
}

// Only confident matches deduct anything automatically (exact name, a name
// the owner mapped before, or the name with a size/temperature suffix
// stripped). Anything else is recorded as "unmatched" for the owner to map,
// never guessed — nobody is watching an automatic sync.
export function priceOrders(
  orders: SquareOrder[],
  menuItems: MenuItem[],
  items: InventoryItem[],
  aliases: Record<string, number>,
  config: PricingConfig = { sizes: {}, rules: {} }
): PricedOrder[] {
  const recipes = menuItems.map((m) => ({ id: m.id, name: m.name }));
  const byId = new Map(menuItems.map((m) => [m.id, m]));

  return orders.map((order) => {
    const sales: SaleLine[] = [];
    const unmatched: PricedOrder["unmatched"] = [];
    const sizes: PricedOrder["sizes"] = [];
    const modifiers: PricedOrder["modifiers"] = [];
    for (const line of order.line_items ?? []) {
      if (line.item_type === "GIFT_CARD" || !line.name) continue;
      const qty = Number(line.quantity);
      if (!Number.isFinite(qty) || qty <= 0) continue;
      const row: ParsedRow = buildRow(line.name, line.variation_name, qty);
      const match = matchRecipe(row, recipes, aliases);
      const recipe = match.recipeId !== null ? byId.get(match.recipeId) : undefined;
      if (!recipe) {
        unmatched.push({ key: row.key, name: row.name, variation: row.variation, qty });
        continue;
      }

      // Size: only when the size is not already part of the recipe's own name.
      let scale = 1;
      if (row.variation && !match.viaVariation) {
        const sizeKey = normalizeName(row.variation);
        scale = config.sizes[sizeKey] ?? 1;
        sizes.push({ key: sizeKey, label: row.variation });
      }

      // Modifiers: apply the owner's rule for each; unknown ones are recorded
      // for setup and, until then, change nothing.
      const adds: { itemId: number; amount: number }[] = [];
      const swaps: { from: number; to: number }[] = [];
      for (const mod of line.modifiers ?? []) {
        if (!mod.name) continue;
        const modKey = normalizeName(mod.name);
        if (!modKey) continue;
        const modQty = Number(mod.quantity ?? "1");
        const times = Number.isFinite(modQty) && modQty > 0 ? modQty : 1;
        modifiers.push({ key: modKey, label: mod.name.trim() });
        for (const effect of config.rules[modKey] ?? []) {
          if (effect.type === "add") adds.push({ itemId: effect.itemId, amount: effect.amount * times * qty });
          else swaps.push({ from: effect.fromItemId, to: effect.toItemId });
        }
      }

      sales.push({ menuItem: recipe, qty, scale, adds, swaps });
    }
    const { byItem } = computeDeductions(sales, items);
    return { id: order.id, deltas: byItem, unmatched, sizes, modifiers };
  });
}

// Reads a stored effects array defensively: anything malformed counts as "not
// set up" (null) rather than risking a wrong deduction.
export function parseEffects(raw: unknown): ModifierEffect[] | null {
  if (!Array.isArray(raw)) return null;
  const out: ModifierEffect[] = [];
  for (const e of raw) {
    if (!e || typeof e !== "object") return null;
    const x = e as Record<string, unknown>;
    if (x.type === "add" && Number.isInteger(x.itemId) && typeof x.amount === "number" && Number.isFinite(x.amount) && x.amount >= 0) {
      out.push({ type: "add", itemId: x.itemId as number, amount: x.amount });
    } else if (x.type === "swap" && Number.isInteger(x.fromItemId) && Number.isInteger(x.toItemId)) {
      out.push({ type: "swap", fromItemId: x.fromItemId as number, toItemId: x.toItemId as number });
    } else {
      return null;
    }
  }
  return out;
}

// ---- The sync --------------------------------------------------------------

export interface SyncSummary {
  status: "synced" | "not_connected" | "needs_reconnect" | "not_pro" | "error";
  ordersSeen: number;
  ordersApplied: number;
  message?: string;
}

interface ConnectionRow {
  shop_id: string;
  access_token_enc: string;
  refresh_token_enc: string;
  expires_at: string;
  location_ids: string[];
  sync_from: string;
  last_synced_at: string | null;
  status: string;
}

export async function syncShop(admin: SupabaseClient, shopId: string): Promise<SyncSummary> {
  const none = { ordersSeen: 0, ordersApplied: 0 };

  const { data: conn } = await admin.from("square_connections").select("*").eq("shop_id", shopId).maybeSingle();
  if (!conn) return { status: "not_connected", ...none };
  const c = conn as ConnectionRow;
  if (c.status === "needs_reconnect") return { status: "needs_reconnect", ...none };

  // Pro only: a shop that downgraded or cancelled keeps its connection (so
  // upgrading again just works) but stops being synced.
  const { data: shop } = await admin.from("shops").select("tier").eq("id", shopId).maybeSingle();
  if (shop?.tier !== "pro") return { status: "not_pro", ...none };

  const startedAt = new Date();
  try {
    let accessToken = decryptToken(c.access_token_enc);

    if (new Date(c.expires_at).getTime() - Date.now() < REFRESH_WITHIN_MS) {
      const fresh = await refreshAccessToken(decryptToken(c.refresh_token_enc));
      accessToken = fresh.access_token;
      await admin
        .from("square_connections")
        .update({ access_token_enc: encryptToken(fresh.access_token), expires_at: fresh.expires_at })
        .eq("shop_id", shopId);
    }

    const locationIds = await listActiveLocationIds(accessToken);
    if (locationIds.length === 0) {
      await admin.from("square_connections").update({ last_synced_at: startedAt.toISOString(), last_error: null }).eq("shop_id", shopId);
      return { status: "synced", ...none };
    }

    const syncFrom = new Date(c.sync_from);
    const lookback = c.last_synced_at ? new Date(new Date(c.last_synced_at).getTime() - LOOKBACK_MS) : syncFrom;
    const since = lookback > syncFrom ? lookback : syncFrom;

    const orders = await searchClosedOrders(accessToken, locationIds, since);

    // Skip orders already counted before doing any pricing work.
    const seen = new Set<string>();
    for (let i = 0; i < orders.length; i += 200) {
      const ids = orders.slice(i, i + 200).map((o) => o.id);
      const { data } = await admin.from("square_orders_seen").select("order_id").eq("shop_id", shopId).in("order_id", ids);
      for (const row of data ?? []) seen.add(row.order_id as string);
    }
    const fresh = orders.filter((o) => !seen.has(o.id));

    let applied = 0;
    if (fresh.length > 0) {
      const [{ data: itemRows }, { data: menuRows }, { data: aliasRows }, { data: sizeRows }, { data: ruleRows }] = await Promise.all([
        admin.from("items").select("id, name, unit, count, threshold, category, unit_size, unit_measure").eq("shop_id", shopId),
        admin.from("menu_items").select("id, name, ingredients(id, item_id, amount)").eq("shop_id", shopId),
        admin.from("sales_aliases").select("name_key, menu_item_id").eq("shop_id", shopId),
        admin.from("sales_sizes").select("size_key, multiplier").eq("shop_id", shopId),
        admin.from("modifier_rules").select("name_key, effects").eq("shop_id", shopId),
      ]);
      const items: InventoryItem[] = (itemRows ?? []).map((r) => ({
        id: r.id,
        name: r.name,
        unit: r.unit,
        count: Number(r.count),
        threshold: Number(r.threshold),
        category: r.category,
        unitSize: r.unit_size === null ? null : Number(r.unit_size),
        unitMeasure: r.unit_measure,
      }));
      const menuItems: MenuItem[] = (menuRows ?? []).map((m) => ({
        id: m.id,
        name: m.name,
        ingredients: ((m.ingredients ?? []) as { id: number; item_id: number; amount: number }[]).map((i) => ({
          id: i.id,
          itemId: i.item_id,
          amount: Number(i.amount),
        })),
      }));
      const aliases: Record<string, number> = {};
      for (const a of aliasRows ?? []) aliases[a.name_key as string] = a.menu_item_id as number;

      // If the size/modifier tables aren't there yet (migration not run), these
      // come back empty and the sync behaves exactly as before.
      const config: PricingConfig = { sizes: {}, rules: {} };
      for (const r of sizeRows ?? []) config.sizes[r.size_key as string] = Number(r.multiplier);
      for (const r of ruleRows ?? []) config.rules[r.name_key as string] = parseEffects(r.effects);

      const priced = priceOrders(fresh, menuItems, items, aliases, config);
      for (let i = 0; i < priced.length; i += 200) {
        const { data, error } = await admin.rpc("apply_square_sales", {
          p_shop_id: shopId,
          p_orders: priced.slice(i, i + 200),
        });
        if (error) throw new Error(`apply_square_sales failed: ${error.message}`);
        applied += Number(data ?? 0);
      }
    }

    await admin
      .from("square_connections")
      .update({ last_synced_at: startedAt.toISOString(), last_error: null, location_ids: locationIds })
      .eq("shop_id", shopId);
    // Housekeeping: nothing older than the lookback window can come back.
    await admin
      .from("square_orders_seen")
      .delete()
      .eq("shop_id", shopId)
      .lt("processed_at", new Date(Date.now() - 3 * LOOKBACK_MS).toISOString());

    return { status: "synced", ordersSeen: orders.length, ordersApplied: applied };
  } catch (err) {
    if (err instanceof SquareError && err.isAuthFailure) {
      await admin
        .from("square_connections")
        .update({ status: "needs_reconnect", last_error: "Square access was revoked." })
        .eq("shop_id", shopId);
      return { status: "needs_reconnect", ...none };
    }
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error(`Square sync failed for ${shopId}:`, err);
    await admin.from("square_connections").update({ last_error: message.slice(0, 300) }).eq("shop_id", shopId);
    return { status: "error", ...none, message };
  }
}
