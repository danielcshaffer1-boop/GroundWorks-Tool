import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { syncShop } from "@/lib/square";
import { requireProOwner } from "@/lib/square-route";

export const maxDuration = 60;

// Mashing the button shouldn't hammer Square: a sync that finished this
// recently already has everything.
const COOLDOWN_MS = 15_000;

// "Sync now" button. The scheduled run does the same thing every few minutes;
// this just lets an owner see a result immediately.
export async function POST() {
  const guard = await requireProOwner();
  if ("response" in guard) return guard.response;
  const admin = getSupabaseAdmin();

  const { data: conn } = await admin.from("square_connections").select("last_synced_at").eq("shop_id", guard.shopId).maybeSingle();
  const last = conn?.last_synced_at ? new Date(conn.last_synced_at as string).getTime() : 0;
  if (Date.now() - last < COOLDOWN_MS) {
    return NextResponse.json({ status: "synced", ordersSeen: 0, ordersApplied: 0, message: "Just synced a moment ago." });
  }

  const summary = await syncShop(admin, guard.shopId);
  return NextResponse.json(summary);
}
