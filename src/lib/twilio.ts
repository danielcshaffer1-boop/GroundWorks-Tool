// Server-only. Auth Token is stored base64-wrapped (TWILIO_AUTH_TOKEN_B64)
// as a preemptive measure — the same class of value (a GitHub/Vercel
// secret-scanning partner format) that got silently mangled by the deploy
// pipeline for Supabase's keys, see src/lib/supabase/anon-key.ts for the
// full story. Untested whether Twilio's token triggers the same issue,
// but the fix is cheap and this avoids re-running that whole investigation
// if it does.

export function getTwilioAuthToken(): string {
  const encoded = process.env.TWILIO_AUTH_TOKEN_B64;
  if (!encoded) {
    throw new Error("TWILIO_AUTH_TOKEN_B64 is not set.");
  }
  return atob(encoded);
}

export function getTwilioAccountSid(): string {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  if (!sid) {
    throw new Error("TWILIO_ACCOUNT_SID is not set.");
  }
  return sid;
}

export function getTwilioPhoneNumber(): string {
  const phone = process.env.TWILIO_PHONE_NUMBER;
  if (!phone) {
    throw new Error("TWILIO_PHONE_NUMBER is not set.");
  }
  return phone;
}
