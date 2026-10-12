import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { parseEffects } from "@/lib/square";
import { requireProOwner } from "@/lib/square-route";

// Saves what a Square modifier does to stock: nothing ([]), uses an extra
// ingredient, or swaps one ingredient for another. Every item referenced must
// belong to this shop, and the rule must parse cleanly (anything malformed is
// rejected rather than stored, because a bad rule would mis-deduct silently).
export async function POST(request: NextRequest) {
  const guard = await requireProOwner();
  if ("response" in guard) return guard.response;

  const body = (await request.json().catch(() => null)) as { key?: unknown; effects?: unknown } | null;
  const key = body?.key;
  const effects = parseEffects(body?.effects);
  if (typeof key !== "string" || !key || effects === null) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }
  if (effects.length > 5) return NextResponse.json({ error: "Too many effects." }, { status: 400 });

  const itemIds = new Set<number>();
  for (const e of effects) {
    if (e.type === "add") itemIds.add(e.itemId);
    else {
      if (e.fromItemId === e.toItemId) {
        return NextResponse.json({ error: "Pick two different ingredients to swap." }, { status: 400 });
      }
      itemIds.add(e.fromItemId);
      itemIds.add(e.toItemId);
    }
  }

  const admin = getSupabaseAdmin();
  if (itemIds.size > 0) {
    const { data: owned } = await admin
      .from("items")
      .select("id")
      .eq("shop_id", guard.shopId)
      .in("id", [...itemIds]);
    if ((owned ?? []).length !== itemIds.size) {
      return NextResponse.json({ error: "One of those ingredients doesn't exist." }, { status: 404 });
    }
  }

  const { data, error } = await admin
    .from("modifier_rules")
    .update({ effects })
    .eq("shop_id", guard.shopId)
    .eq("name_key", key)
    .select("name_key");
  if (error) return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  if (!data || data.length === 0) return NextResponse.json({ error: "Modifier not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
