import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { normalizeName } from "@/lib/sales-import";
import { requireProOwner } from "@/lib/square-route";

// Resolve one sold-but-unmatched item from the Recipes tab: either remember
// that its Square name means one of the owner's recipes (applies to future
// sales — past ones aren't re-deducted), or dismiss it.
export async function POST(request: NextRequest) {
  const guard = await requireProOwner();
  if ("response" in guard) return guard.response;

  const body = (await request.json().catch(() => null)) as { key?: string; menuItemId?: number | null } | null;
  if (!body?.key) return NextResponse.json({ error: "Missing item." }, { status: 400 });

  const admin = getSupabaseAdmin();
  const { data: row } = await admin
    .from("square_unmatched")
    .select("name, variation")
    .eq("shop_id", guard.shopId)
    .eq("name_key", body.key)
    .maybeSingle();
  if (!row) return NextResponse.json({ ok: true });

  if (typeof body.menuItemId === "number") {
    const { data: recipe } = await admin
      .from("menu_items")
      .select("id")
      .eq("id", body.menuItemId)
      .eq("shop_id", guard.shopId)
      .maybeSingle();
    if (!recipe) return NextResponse.json({ error: "That recipe doesn't exist." }, { status: 404 });
    // Same key shape the matcher looks up: the full "name variation" text when
    // there is a variation, else just the name.
    const aliasKey = normalizeName(row.variation ? `${row.name} ${row.variation}` : (row.name as string));
    const { error } = await admin
      .from("sales_aliases")
      .upsert({ shop_id: guard.shopId, name_key: aliasKey, menu_item_id: recipe.id }, { onConflict: "shop_id,name_key" });
    if (error) return NextResponse.json({ error: "Couldn't save that." }, { status: 500 });
  }

  await admin.from("square_unmatched").delete().eq("shop_id", guard.shopId).eq("name_key", body.key);
  return NextResponse.json({ ok: true });
}
