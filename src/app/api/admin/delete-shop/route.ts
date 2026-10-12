import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { DEMO_SHOP_ID } from "@/lib/demo";
import { decryptToken, revokeAccess, squareConfigured } from "@/lib/square";

// Lets an admin permanently delete a shop and its login: inventory, recipes,
// batches, alert numbers, Square connection — everything. Irreversible, so:
//  - admin-only (same check as set-tier),
//  - the caller must send the shop's exact name back (typed confirmation in the UI,
//    re-checked here so a stray request can't delete anything),
//  - never the public demo shop,
//  - refuses a shop with a live Stripe subscription: deleting would orphan a
//    paying customer's billing. Cancel the subscription in Stripe first.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: adminRow } = await supabase.from("admins").select("id").eq("id", user.id).maybeSingle();
  if (!adminRow) return NextResponse.json({ error: "Not authorized." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { shopId?: unknown; confirmName?: unknown } | null;
  const shopId = body?.shopId;
  const confirmName = body?.confirmName;
  if (typeof shopId !== "string" || typeof confirmName !== "string") {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (shopId === DEMO_SHOP_ID) {
    return NextResponse.json({ error: "The demo shop can't be deleted." }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  const { data: shop } = await admin
    .from("shops")
    .select("id, name, stripe_subscription_id, subscription_status")
    .eq("id", shopId)
    .maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found." }, { status: 404 });
  if (confirmName.trim() !== shop.name) {
    return NextResponse.json({ error: "The name you typed doesn't match this shop." }, { status: 400 });
  }
  const liveStatuses = ["active", "trialing", "past_due", "unpaid"];
  if (shop.stripe_subscription_id && liveStatuses.includes(shop.subscription_status ?? "")) {
    return NextResponse.json(
      { error: "This shop has a live Stripe subscription. Cancel it in Stripe first, then delete the shop." },
      { status: 409 }
    );
  }

  // Best effort: drop our access on Square's side so the app disappears from
  // the owner's authorized apps. Never blocks the delete.
  if (squareConfigured()) {
    try {
      const { data: conn } = await admin
        .from("square_connections")
        .select("access_token_enc")
        .eq("shop_id", shopId)
        .maybeSingle();
      if (conn) await revokeAccess(decryptToken(conn.access_token_enc as string));
    } catch {
      // see above
    }
  }

  // ingredients.item_id is ON DELETE RESTRICT, so recipes go before items;
  // everything else (batches, alert recipients, Square tables) cascades from
  // items or the shop.
  const steps: [string, PromiseLike<{ error: unknown }>][] = [
    ["recipes", admin.from("menu_items").delete().eq("shop_id", shopId)],
    ["items", admin.from("items").delete().eq("shop_id", shopId)],
    ["shop", admin.from("shops").delete().eq("id", shopId)],
  ];
  for (const [label, step] of steps) {
    const { error } = await step;
    if (error) {
      console.error(`Admin delete-shop failed at ${label}:`, error);
      return NextResponse.json({ error: `Couldn't delete the shop's ${label}.` }, { status: 500 });
    }
  }

  const { error: authError } = await admin.auth.admin.deleteUser(shopId);
  if (authError) {
    console.error("Admin delete-shop: shop removed but login delete failed:", authError);
    return NextResponse.json(
      { error: "The shop's data was deleted, but removing the login failed. Remove it in Supabase Auth." },
      { status: 500 }
    );
  }

  return NextResponse.json({ ok: true });
}
