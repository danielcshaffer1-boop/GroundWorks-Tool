import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resetDemoShop } from "@/lib/demo-seed";
import { DEMO_EMAIL, DEMO_PASSWORD, DEMO_SHOP_ID } from "@/lib/demo";
import { hasCronSecret } from "@/lib/safe-equal";

// Invoked once a night by Vercel Cron (see vercel.json) to put the public,
// shared Demo Shop back to its seeded state. Vercel signs cron requests with
// `Authorization: Bearer $CRON_SECRET`, the same check the expiration-alert
// cron uses. Only ever touches the one demo shop id (see lib/demo-seed.ts).
export async function GET(request: Request) {
  if (!hasCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const supabase = getSupabaseAdmin();
    const summary = await resetDemoShop(supabase);

    // Anyone can sign in as the demo, so anyone could also change its login
    // or plan from the browser. Put both back, so "Try the demo" keeps working.
    const { error: loginError } = await supabase.auth.admin.updateUserById(DEMO_SHOP_ID, {
      email: DEMO_EMAIL,
      password: DEMO_PASSWORD,
      email_confirm: true,
    });
    if (loginError) throw loginError;
    const { error: tierError } = await supabase.from("shops").update({ tier: "pro" }).eq("id", DEMO_SHOP_ID);
    if (tierError) throw tierError;

    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("Demo shop reset failed:", err);
    return NextResponse.json({ error: "Demo reset failed." }, { status: 500 });
  }
}
