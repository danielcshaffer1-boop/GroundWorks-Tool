import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  matcher: [
    // Skip static assets and the server-to-server endpoints (webhooks and
    // cron jobs authenticate themselves) — no need to touch auth cookies, or
    // ask Supabase who the caller is, for these.
    "/((?!_next/static|_next/image|favicon.ico|api/stripe/webhook|api/twilio/inbound|api/alerts/|api/demo/reset|api/square/cron|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
