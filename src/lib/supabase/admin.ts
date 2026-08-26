import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Server-only, service-role client. Bypasses RLS entirely, including the
// column-level REVOKE on shops.tier/stripe_* from supabase/005_paid_tiers.sql
// — that revoke only applies to the `authenticated` role; service_role
// ignores it by design. This is the ONE legitimate place in the app that
// should ever touch those columns: the Stripe webhook, which has no
// Supabase Auth session of its own (it's a server-to-server call
// authenticated by Stripe's signature, not a signed-in user) and so has no
// other way to write a shop's tier after payment succeeds.
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
