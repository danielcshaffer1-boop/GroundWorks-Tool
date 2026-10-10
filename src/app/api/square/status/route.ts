import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { squareConfigured } from "@/lib/square";
import { requireProOwner } from "@/lib/square-route";

// What the Recipes tab shows about the Square connection. Never returns the
// tokens themselves — only status, timing, and the sold-but-unmatched list.
export async function GET() {
  const guard = await requireProOwner();
  if ("response" in guard) return guard.response;

  const admin = getSupabaseAdmin();
  const [{ data: conn }, { data: unmatched }] = await Promise.all([
    admin
      .from("square_connections")
      .select("status, last_synced_at, last_error, sync_from")
      .eq("shop_id", guard.shopId)
      .maybeSingle(),
    admin
      .from("square_unmatched")
      .select("name_key, name, variation, qty")
      .eq("shop_id", guard.shopId)
      .order("qty", { ascending: false })
      .limit(50),
  ]);

  return NextResponse.json({
    configured: squareConfigured(),
    connected: Boolean(conn),
    status: conn?.status ?? null,
    lastSyncedAt: conn?.last_synced_at ?? null,
    lastError: conn?.last_error ?? null,
    connectedSince: conn?.sync_from ?? null,
    unmatched: (unmatched ?? []).map((u) => ({
      key: u.name_key,
      name: u.name,
      variation: u.variation,
      qty: Number(u.qty),
    })),
  });
}
