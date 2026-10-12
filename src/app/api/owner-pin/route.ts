import { NextRequest, NextResponse } from "next/server";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getSupabaseAnonKey } from "@/lib/supabase/anon-key";
import { DEMO_SHOP_ID } from "@/lib/demo";
import { LOCKOUT_MS, MAX_ATTEMPTS, hashPin, isValidPin, verifyPin } from "@/lib/owner-pin";

// The owner PIN locks a shop's settings on a shared device. This route:
//   GET                      -> { enabled }
//   POST {action:"verify", pin}                       -> unlocks (checks the PIN; throttled)
//   POST {action:"set", pin, password}                -> sets or changes the PIN
//   POST {action:"remove", password}                  -> turns the PIN off
// Setting or removing needs the shop's ACCOUNT PASSWORD, not just a session:
// the barista who is already signed in on the shared device doesn't know it,
// so they can't set a PIN of their own and lock the owner out.

async function currentShop() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function GET() {
  const user = await currentShop();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  const { data } = await getSupabaseAdmin().from("shop_owner_pins").select("shop_id").eq("shop_id", user.id).maybeSingle();
  return NextResponse.json({ enabled: Boolean(data) });
}

async function passwordIsRight(email: string, password: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url || !password) return false;
  // A throwaway client so this check never touches the real session cookies.
  const probe = createSupabaseClient(url, getSupabaseAnonKey(), { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await probe.auth.signInWithPassword({ email, password });
  return !error;
}

export async function POST(request: NextRequest) {
  const user = await currentShop();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (user.id === DEMO_SHOP_ID) {
    return NextResponse.json({ error: "The demo has no owner PIN." }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { action?: unknown; pin?: unknown; password?: unknown } | null;
  const admin = getSupabaseAdmin();

  if (body?.action === "verify") {
    if (!isValidPin(body.pin)) return NextResponse.json({ error: "Enter your 4 to 6 digit PIN." }, { status: 400 });
    const { data: row } = await admin
      .from("shop_owner_pins")
      .select("pin_hash, failed_attempts, locked_until")
      .eq("shop_id", user.id)
      .maybeSingle();
    if (!row) return NextResponse.json({ ok: true }); // no PIN set: nothing to unlock

    if (row.locked_until && new Date(row.locked_until as string).getTime() > Date.now()) {
      const minutes = Math.max(1, Math.ceil((new Date(row.locked_until as string).getTime() - Date.now()) / 60000));
      return NextResponse.json({ error: `Too many wrong tries. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.` }, { status: 429 });
    }

    if (verifyPin(body.pin, row.pin_hash as string)) {
      await admin.from("shop_owner_pins").update({ failed_attempts: 0, locked_until: null }).eq("shop_id", user.id);
      return NextResponse.json({ ok: true });
    }

    const attempts = Number(row.failed_attempts) + 1;
    const lock = attempts >= MAX_ATTEMPTS;
    await admin
      .from("shop_owner_pins")
      .update({ failed_attempts: lock ? 0 : attempts, locked_until: lock ? new Date(Date.now() + LOCKOUT_MS).toISOString() : null })
      .eq("shop_id", user.id);
    return NextResponse.json(
      { error: lock ? "Too many wrong tries. Locked for 5 minutes." : `That PIN isn't right. ${MAX_ATTEMPTS - attempts} ${MAX_ATTEMPTS - attempts === 1 ? "try" : "tries"} left.` },
      { status: 401 }
    );
  }

  if (body?.action === "set" || body?.action === "remove") {
    if (!user.email || typeof body.password !== "string" || !(await passwordIsRight(user.email, body.password))) {
      return NextResponse.json({ error: "That account password isn't right." }, { status: 401 });
    }
    if (body.action === "remove") {
      await admin.from("shop_owner_pins").delete().eq("shop_id", user.id);
      return NextResponse.json({ ok: true });
    }
    if (!isValidPin(body.pin)) return NextResponse.json({ error: "Use a PIN of 4 to 6 digits." }, { status: 400 });
    const { error } = await admin
      .from("shop_owner_pins")
      .upsert({ shop_id: user.id, pin_hash: hashPin(body.pin), failed_attempts: 0, locked_until: null, updated_at: new Date().toISOString() }, { onConflict: "shop_id" });
    if (error) return NextResponse.json({ error: "Couldn't save the PIN." }, { status: 500 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "Invalid request." }, { status: 400 });
}
