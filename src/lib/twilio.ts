import { createHmac, timingSafeEqual } from "crypto";

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

// Verifies the X-Twilio-Signature header on an inbound webhook request, so
// /api/twilio/inbound only acts on requests that actually came from Twilio
// — otherwise anyone could POST a fake "STOP" and silently unsubscribe a
// shop's alert number. Implements Twilio's documented algorithm: HMAC-SHA1
// of the full request URL with every POST param's key+value appended (in
// the order Twilio sends them, sorted alphabetically by key, no separators
// between pairs), keyed by the Auth Token, then base64-compared.
export function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signatureHeader: string | null
): boolean {
  if (!signatureHeader) return false;
  const authToken = getTwilioAuthToken();
  const sortedKeys = Object.keys(params).sort();
  const data = sortedKeys.reduce((acc, key) => acc + key + params[key], url);
  const expected = createHmac("sha1", authToken).update(data, "utf8").digest("base64");
  const expectedBuf = Buffer.from(expected);
  const actualBuf = Buffer.from(signatureHeader);
  return expectedBuf.length === actualBuf.length && timingSafeEqual(expectedBuf, actualBuf);
}
