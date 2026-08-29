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

// Shared send helper — used by the expiring-batches cron route. The
// original item-updated webhook route predates this and inlines the same
// call directly; left as-is rather than refactored onto this, since it's
// already proven working against real Twilio credentials and a refactor
// risks regressing that for no functional gain.
export async function sendSms(to: string, body: string): Promise<Response> {
  const accountSid = getTwilioAccountSid();
  const authToken = getTwilioAuthToken();
  const fromNumber = getTwilioPhoneNumber();
  return fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ To: to, From: fromNumber, Body: body }),
  });
}
