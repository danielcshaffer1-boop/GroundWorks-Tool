import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireProOwner } from "@/lib/square-route";

// Sets how much more (or less) of a recipe a size uses: a Large at 1.33 means
// every ingredient of a drink sold as "Large" is deducted 1.33x. Applies shop
// wide to the size by name; recipes are the base size.
export async function POST(request: NextRequest) {
  const guard = await requireProOwner();
  if ("response" in guard) return guard.response;

  const body = (await request.json().catch(() => null)) as { key?: unknown; multiplier?: unknown } | null;
  const key = body?.key;
  const multiplier = body?.multiplier;
  if (typeof key !== "string" || !key || typeof multiplier !== "number" || !Number.isFinite(multiplier)) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (multiplier <= 0 || multiplier > 10) {
    return NextResponse.json({ error: "Use a multiplier between 0 and 10, like 1.33 for a Large." }, { status: 400 });
  }

  const { data, error } = await getSupabaseAdmin()
    .from("sales_sizes")
    .update({ multiplier: Math.round(multiplier * 1000) / 1000, confirmed: true })
    .eq("shop_id", guard.shopId)
    .eq("size_key", key)
    .select("size_key");
  if (error) return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Size not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
