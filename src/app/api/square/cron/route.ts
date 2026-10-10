import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { squareConfigured, syncShop } from "@/lib/square";

export const maxDuration = 300;

// Vercel Cron (see vercel.json) calls this every few minutes with
// `Authorization: Bearer $CRON_SECRET`, same check as the other crons.
// Syncs every connected shop that is still in good standing; one shop's
// failure never stops the others.
export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }
  if (!squareConfigured()) return NextResponse.json({ ok: true, skipped: "square not configured" });

  const admin = getSupabaseAdmin();
  const { data: conns, error } = await admin.from("square_connections").select("shop_id").eq("status", "active");
  if (error) {
    console.error("Couldn't list Square connections:", error);
    return NextResponse.json({ error: "Couldn't list connections." }, { status: 500 });
  }

  const results: Record<string, number> = {};
  for (const { shop_id } of conns ?? []) {
    const summary = await syncShop(admin, shop_id as string);
    results[summary.status] = (results[summary.status] ?? 0) + 1;
  }
  return NextResponse.json({ ok: true, shops: conns?.length ?? 0, results });
}
