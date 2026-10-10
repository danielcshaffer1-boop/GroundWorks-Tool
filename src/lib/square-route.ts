import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { DEMO_SHOP_ID } from "@/lib/demo";

// Shared guard for the /api/square/* routes a signed-in owner calls from the
// dashboard: must be signed in, not the public demo, and on the Pro plan
// (the Square connection is a Pro feature, enforced here and again in the
// sync itself — hiding a button is not a boundary).
export async function requireProOwner(): Promise<{ shopId: string } | { response: NextResponse }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { response: NextResponse.json({ error: "Not signed in." }, { status: 401 }) };
  if (user.id === DEMO_SHOP_ID) {
    return { response: NextResponse.json({ error: "Square can't be connected in the demo." }, { status: 403 }) };
  }
  const { data: shop } = await supabase.from("shops").select("tier").eq("id", user.id).maybeSingle();
  if (shop?.tier !== "pro") {
    return { response: NextResponse.json({ error: "Square is part of the Pro plan." }, { status: 403 }) };
  }
  return { shopId: user.id };
}
