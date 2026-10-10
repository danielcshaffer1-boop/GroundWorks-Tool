import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { syncShop } from "@/lib/square";
import { requireProOwner } from "@/lib/square-route";

export const maxDuration = 60;

// "Sync now" button. The scheduled run does the same thing every few minutes;
// this just lets an owner see a result immediately.
export async function POST() {
  const guard = await requireProOwner();
  if ("response" in guard) return guard.response;
  const summary = await syncShop(getSupabaseAdmin(), guard.shopId);
  return NextResponse.json(summary);
}
