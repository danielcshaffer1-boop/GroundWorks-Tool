import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireTwoStep } from "@/lib/admin-mfa";
import type { Tier } from "@/lib/types";

// Lets an admin manually set a shop's tier, which the browser roles can't write
// (see 016_shops_lockdown.sql; same mechanism the Stripe
// webhook uses — service-role client, gated here by our own admin check
// rather than by Stripe's signature).
//
// Note this doesn't touch Stripe at all: if the shop has an active
// subscription, the next webhook event (a renewal, a portal change, etc.)
// can overwrite this override back to whatever Stripe says. That's
// disclosed in the admin UI, not just here.
export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const { data: adminRow } = await supabase.from("admins").select("id").eq("id", user.id).maybeSingle();
  if (!adminRow) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }
  const needTwoStep = await requireTwoStep(supabase);
  if (needTwoStep) return needTwoStep;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { shopId, tier } = (body ?? {}) as { shopId?: unknown; tier?: unknown };
  if (typeof shopId !== "string" || (tier !== "none" && tier !== "standard" && tier !== "pro")) {
    return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  }

  const admin = getSupabaseAdmin();
  const { data: updated, error } = await admin
    .from("shops")
    .update({ tier: tier as Tier })
    .eq("id", shopId)
    .select("id");

  if (error) {
    console.error("Admin set-tier failed:", error);
    return NextResponse.json({ error: "Couldn't update tier." }, { status: 500 });
  }
  if (!updated || updated.length === 0) {
    return NextResponse.json({ error: "Shop not found." }, { status: 404 });
  }
  console.info(`[admin-audit] ${user.id} set shop ${shopId} to ${tier}`);

  return NextResponse.json({ ok: true });
}
