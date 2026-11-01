import "server-only";
import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Admin actions change other shops' plans or delete them, so a password alone
// isn't enough: the session must also have passed a two-step (TOTP) check
// (Supabase "aal2"). Returns a 403 response to send back, or null when fine.
export async function requireTwoStep(supabase: SupabaseClient): Promise<NextResponse | null> {
  const { data } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (data?.currentLevel === "aal2") return null;
  return NextResponse.json(
    { error: "Two-step verification needed. Enter your authenticator code at the top of the Admin screen first." },
    { status: 403 }
  );
}
