import "server-only";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only, service-role client. Bypasses RLS entirely, including the
// column grants and trigger on shops.tier/stripe_* from
// supabase/016_shops_lockdown.sql — those only restrict the browser roles
// (`authenticated`/`anon`); service_role ignores them by design. This is the
// legitimate place in the app that writes those columns: the Stripe webhook
// (a server-to-server call authenticated by Stripe's signature, not a
// signed-in user) and the admin routes.
//
// Never import this from a client component or any route reachable by a
// browser request without independently verifying a Stripe signature first.

let client: SupabaseClient | null = null;

// Stored base64-wrapped (SUPABASE_SERVICE_ROLE_KEY_B64), same reasoning as
// the anon key in anon-key.ts — the raw JWT form gets silently mangled by
// something in the Vercel deploy pipeline. Decoded here at runtime.
function getServiceRoleKey(): string {
  const encoded = process.env.SUPABASE_SERVICE_ROLE_KEY_B64;
  if (!encoded) {
    throw new Error("SUPABASE_SERVICE_ROLE_KEY_B64 is not set.");
  }
  return atob(encoded);
}

export function getSupabaseAdmin(): SupabaseClient {
  if (client) return client;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL must be set.");
  }

  client = createClient(url, getServiceRoleKey(), {
    auth: { persistSession: false },
  });
  return client;
}
