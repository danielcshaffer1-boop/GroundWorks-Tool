import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { decryptToken, revokeAccess } from "@/lib/square";
import { createClient } from "@/lib/supabase/server";
import { DEMO_SHOP_ID } from "@/lib/demo";

// Disconnects Square: tells Square to drop our access, then forgets the
// tokens. Deliberately NOT Pro-gated — a shop that downgraded must still be
// able to cut the connection. Remembered name mappings are kept.
export async function POST() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || user.id === DEMO_SHOP_ID) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const admin = getSupabaseAdmin();
  const { data: conn } = await admin
    .from("square_connections")
    .select("access_token_enc")
    .eq("shop_id", user.id)
    .maybeSingle();
  if (conn) {
    try {
      await revokeAccess(decryptToken(conn.access_token_enc as string));
    } catch {
      // Couldn't decrypt or reach Square: still disconnect on our side.
    }
    await admin.from("square_connections").delete().eq("shop_id", user.id);
  }
  await admin.from("square_unmatched").delete().eq("shop_id", user.id);
  return NextResponse.json({ ok: true });
}
