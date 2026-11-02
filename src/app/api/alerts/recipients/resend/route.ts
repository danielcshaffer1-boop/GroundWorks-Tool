import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { DEMO_SHOP_ID } from "@/lib/demo";
import { sendConfirmationText } from "@/lib/alert-consent";

// Sends the "reply YES" text again to a number that hasn't confirmed yet
// (for example, the first one was missed). Rate-limited per number and shop.
const MAX_SENDS_PER_NUMBER = 3;

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.id === DEMO_SHOP_ID) return NextResponse.json({ error: "Text alerts are turned off in the demo." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { id?: unknown } | null;
  if (typeof body?.id !== "number") return NextResponse.json({ error: "Invalid request." }, { status: 400 });

  // Read through the signed-in client, so only this shop's own rows can be found.
  const { data: row } = await supabase
    .from("alert_recipients")
    .select("id, phone, confirmed_at, confirmation_sends")
    .eq("id", body.id)
    .maybeSingle();
  if (!row) return NextResponse.json({ error: "Number not found." }, { status: 404 });
  if (row.confirmed_at) return NextResponse.json({ error: "That number is already confirmed." }, { status: 409 });
  if (Number(row.confirmation_sends) >= MAX_SENDS_PER_NUMBER) {
    return NextResponse.json({ error: "We've already texted that number three times. Check the number, or remove it and add it again tomorrow." }, { status: 429 });
  }

  const { data: shop } = await supabase.from("shops").select("name, tier").eq("id", user.id).maybeSingle();
  if (!shop || (shop.tier !== "standard" && shop.tier !== "pro")) {
    return NextResponse.json({ error: "Text alerts need an active plan." }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  const sent = await sendConfirmationText(admin, { shopId: user.id, shopName: shop.name as string, phone: row.phone as string });
  if (!sent.ok) return NextResponse.json({ error: sent.error }, { status: sent.status });

  await admin
    .from("alert_recipients")
    .update({ confirmation_sent_at: new Date().toISOString(), confirmation_sends: Number(row.confirmation_sends) + 1 })
    .eq("id", row.id);
  return NextResponse.json({ ok: true });
}
