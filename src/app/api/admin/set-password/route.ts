import { randomInt } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { requireTwoStep } from "@/lib/admin-mfa";
import { DEMO_SHOP_ID } from "@/lib/demo";

// Lets an admin set a new temporary password on a shop's login, for the owner
// who has forgotten theirs (GroundWorks sends customers no email, so there is no
// emailed reset link). The new password is generated here, set through the
// auth admin API, and returned once so it can be passed on to the owner.
// Admin-only, behind the same two-step check as the other admin actions.
// Letters and digits that are hard to misread aloud (no 0/O, 1/l/I).
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

function temporaryPassword(): string {
  const group = () => Array.from({ length: 4 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  return `${group()}-${group()}-${group()}`;
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });

  const { data: adminRow } = await supabase.from("admins").select("id").eq("id", user.id).maybeSingle();
  if (!adminRow) return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  const needTwoStep = await requireTwoStep(supabase);
  if (needTwoStep) return needTwoStep;

  const body = (await request.json().catch(() => null)) as { shopId?: unknown } | null;
  const shopId = body?.shopId;
  if (typeof shopId !== "string") return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (shopId === DEMO_SHOP_ID) {
    return NextResponse.json({ error: "The demo account's password is managed automatically." }, { status: 403 });
  }

  const admin = getSupabaseAdmin();
  // Admin logins are not reset from here, so this screen can't be used to take one over.
  const { data: targetAdmin } = await admin.from("admins").select("id").eq("id", shopId).maybeSingle();
  if (targetAdmin) return NextResponse.json({ error: "Admin accounts can't be changed here." }, { status: 403 });
  const { data: shop } = await admin.from("shops").select("id").eq("id", shopId).maybeSingle();
  if (!shop) return NextResponse.json({ error: "Shop not found." }, { status: 404 });

  const password = temporaryPassword();
  const { error } = await admin.auth.admin.updateUserById(shopId, { password });
  if (error) {
    console.error("Admin set-password failed:", error);
    return NextResponse.json({ error: "Couldn't set the password." }, { status: 500 });
  }

  console.info(`[admin-audit] ${user.id} set a temporary password for shop ${shopId}`);
  return NextResponse.json({ ok: true, password });
}
