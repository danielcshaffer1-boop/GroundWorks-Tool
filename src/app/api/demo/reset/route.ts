import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { resetDemoShop } from "@/lib/demo-seed";

// Invoked once a night by Vercel Cron (see vercel.json) to put the public,
// shared Demo Shop back to its seeded state. Vercel signs cron requests with
// `Authorization: Bearer $CRON_SECRET`, the same check the expiration-alert
// cron uses. Only ever touches the one demo shop id (see lib/demo-seed.ts).
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  try {
    const summary = await resetDemoShop(getSupabaseAdmin());
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    console.error("Demo shop reset failed:", err);
    return NextResponse.json({ error: "Demo reset failed." }, { status: 500 });
  }
}
