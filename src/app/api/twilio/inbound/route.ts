import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyTwilioSignature } from "@/lib/twilio";

// Twilio's "A message comes in" webhook for our number — the other half of
// the SMS pipeline. Everything in src/lib/twilio.ts and the alert routes is
// send-only; this is the only place that ever reads an inbound text, and
// it exists specifically to make STOP/HELP compliant: without a webhook
// here, Twilio's platform-level default opt-out handling intercepts STOP
// keywords silently (our app never even learns about it, and the reply
// that goes out is generic Twilio boilerplate, not branded) — required by
// the A2P 10DLC campaign's compliance questionnaire to be brand-specific
// and to actually acknowledge the request. Requires the number to be on a
// Messaging Service with Advanced Opt-Out enabled and its inbound webhook
// pointed here (plain "Default Opt-Out" on a bare number never reaches
// this route at all for STOP-family keywords).

const STOP_KEYWORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT"];
const HELP_KEYWORDS = ["HELP", "INFO"];
const START_KEYWORDS = ["START", "YES", "UNSTOP"];

const STOP_REPLY =
  "GroundWorks Inventory: You have been unsubscribed and will not receive any further text alerts. Reply START to opt back in.";
const HELP_REPLY =
  "GroundWorks Inventory: Automated inventory alerts. Msg frequency varies. Msg &amp; data rates may apply. Reply STOP to cancel. Support: danielcshaffer1@gmail.com";
const START_REPLY =
  "GroundWorks Inventory: You're not currently subscribed. Add your number again from the Alerts tab in the app to resume text alerts.";

function twiml(message?: string): NextResponse {
  const body = message ? `<Message>${message}</Message>` : "";
  return new NextResponse(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, {
    status: 200,
    headers: { "Content-Type": "text/xml" },
  });
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const params: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(rawBody)) {
    params[key] = value;
  }

  const signature = request.headers.get("x-twilio-signature");
  if (!verifyTwilioSignature(request.url, params, signature)) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const body = (params.Body ?? "").trim().toUpperCase();
  const from = params.From ?? "";

  if (STOP_KEYWORDS.includes(body) && from) {
    // Global, not per-shop: honoring an opt-out only for the shop that
    // happened to add this number first isn't what "no further messages"
    // means. Removing the row is enough — there's nothing else to fire
    // future alerts from since every send reads this table fresh.
    const supabase = getSupabaseAdmin();
    const { error } = await supabase.from("alert_recipients").delete().eq("phone", from);
    if (error) {
      console.error("Couldn't remove opted-out recipient:", error);
    }
    return twiml(STOP_REPLY);
  }

  if (HELP_KEYWORDS.includes(body)) {
    return twiml(HELP_REPLY);
  }

  if (START_KEYWORDS.includes(body)) {
    return twiml(START_REPLY);
  }

  // This number is alert-only, not a two-way conversation — stay silent
  // on anything that isn't a compliance keyword rather than auto-replying
  // to arbitrary inbound texts.
  return twiml();
}
