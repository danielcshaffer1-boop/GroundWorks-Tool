import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { Tier } from "@/lib/types";

// Lets an admin manually set a shop's tier, bypassing the column-level
// REVOKE on shops.tier from 005_paid_tiers.sql (same mechanism the Stripe
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
  const { error } = await admin
    .from("shops")
    .update({ tier: tier as Tier })
    .eq("id", shopId);

  if (error) {
    console.error("Admin set-tier failed:", error);
    return NextResponse.json({ error: "Couldn't update tier." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
