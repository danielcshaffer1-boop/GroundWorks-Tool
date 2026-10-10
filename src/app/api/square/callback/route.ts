import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { encryptToken, exchangeCode, listActiveLocationIds, squareConfigured, syncShop } from "@/lib/square";
import { requireProOwner } from "@/lib/square-route";

// Square sends the seller back here with ?code=...&state=... (or ?error=... if
// they declined). Never trust the redirect on its own: the state must match
// the cookie set by /connect, and the signed-in shop must still be Pro.
export async function GET(request: NextRequest) {
  const done = (result: string) => {
    const res = NextResponse.redirect(new URL(`/?square=${result}`, request.nextUrl.origin));
    res.cookies.delete({ name: "sq_oauth_state", path: "/api/square" });
    return res;
  };

  const params = request.nextUrl.searchParams;
  if (params.get("error")) return done("declined");

  const code = params.get("code");
  const state = params.get("state");
  const cookieState = request.cookies.get("sq_oauth_state")?.value;
  if (!code || !state || !cookieState || state !== cookieState || !squareConfigured()) return done("error");

  const guard = await requireProOwner();
  if ("response" in guard) return done("error");

  try {
    const redirectUri = `${request.nextUrl.origin}/api/square/callback`;
    const tokens = await exchangeCode(code, redirectUri);
    const locationIds = await listActiveLocationIds(tokens.access_token);

    const admin = getSupabaseAdmin();
    const { data: existing } = await admin
      .from("square_connections")
      .select("merchant_id")
      .eq("shop_id", guard.shopId)
      .maybeSingle();

    // Reconnecting to the SAME Square account keeps the original start date
    // and last-sync point, so sales rung up while access was off are still
    // picked up. A different Square account starts fresh from now.
    const sameMerchant = existing?.merchant_id === tokens.merchant_id;
    const { error } = await admin.from("square_connections").upsert(
      {
        shop_id: guard.shopId,
        merchant_id: tokens.merchant_id,
        access_token_enc: encryptToken(tokens.access_token),
        refresh_token_enc: encryptToken(tokens.refresh_token),
        expires_at: tokens.expires_at,
        location_ids: locationIds,
        status: "active",
        last_error: null,
        ...(sameMerchant ? {} : { sync_from: new Date().toISOString(), last_synced_at: null }),
      },
      { onConflict: "shop_id" }
    );
    if (error) throw error;

    // Pick up anything rung up between now and the first scheduled run.
    await syncShop(admin, guard.shopId);
    return done("connected");
  } catch (err) {
    console.error("Square connect failed:", err);
    return done("error");
  }
}
