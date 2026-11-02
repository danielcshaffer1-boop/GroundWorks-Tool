import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { DEMO_SHOP_ID } from "@/lib/demo";
import { normalizePhone } from "@/lib/phone";
import { CONSENT_TEXT, CONSENT_VERSION, sendConfirmationText } from "@/lib/alert-consent";

// Adds a number to a shop's text alerts. This is the only way a number gets
// added (the browser can't write to alert_recipients directly): the number is
// saved as pending and sent a "reply YES to opt in" text, and only starts
// receiving alerts once /api/twilio/inbound records that YES.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.id === DEMO_SHOP_ID) return NextResponse.json({ error: "Text alerts are turned off in the demo." }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { phone?: unknown; consent?: unknown } | null;
  if (body?.consent !== true) {
    return NextResponse.json({ error: "Tick the box to confirm before adding a number." }, { status: 400 });
  }
  const phone = typeof body.phone === "string" ? normalizePhone(body.phone) : null;
  if (!phone) {
    return NextResponse.json({ error: "That doesn't look like a phone number. Text alerts go to US and Canadian numbers. Try (555) 234-5678." }, { status: 400 });
  }

  // Same plan rule the database applies to alert_recipients (Standard or Pro).
  const { data: shop } = await supabase.from("shops").select("name, tier").eq("id", user.id).maybeSingle();
  if (!shop || (shop.tier !== "standard" && shop.tier !== "pro")) {
    return NextResponse.json({ error: "Text alerts need an active plan." }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  const { data: row, error } = await admin
    .from("alert_recipients")
    .insert({ shop_id: user.id, phone, added_by: user.id, consent_text: `${CONSENT_VERSION}: ${CONSENT_TEXT}` })
    .select("id, phone")
    .single();
  if (error || !row) {
    if (error?.code === "23505") return NextResponse.json({ error: "That number is already on the list." }, { status: 409 });
    if (error?.code === "23514") {
      return NextResponse.json({ error: "A shop can have up to 5 numbers for text alerts. Remove one to add another." }, { status: 409 });
    }
    console.error("Couldn't add an alert recipient:", error);
    return NextResponse.json({ error: "Couldn't add that number. Try again." }, { status: 500 });
  }

  const sent = await sendConfirmationText(admin, { shopId: user.id, shopName: shop.name as string, phone });
  if (!sent.ok) {
    // Don't leave a number on the list that was never asked to confirm.
    await admin.from("alert_recipients").delete().eq("id", row.id);
    return NextResponse.json({ error: sent.error }, { status: sent.status });
  }
  await admin
    .from("alert_recipients")
    .update({ confirmation_sent_at: new Date().toISOString(), confirmation_sends: 1 })
    .eq("id", row.id);

  return NextResponse.json({ ok: true, recipient: { id: row.id, phone: row.phone, confirmed: false } });
}
