"use client";

import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseAnonKey } from "./anon-key";

// Uses the anon key — safe to expose to the browser. Every table it can
// reach is protected by Row Level Security (see supabase/schema.sql and
// supabase/002_auth_and_shops_rls.sql), so this key alone grants no access
// beyond what a given signed-in user's own policies allow.
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, getSupabaseAnonKey());
}
