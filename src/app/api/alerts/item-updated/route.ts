import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getTwilioAccountSid, getTwilioAuthToken, getTwilioPhoneNumber } from "@/lib/twilio";
import type { Status } from "@/lib/types";

// Called by a Supabase Database Webhook (Database -> Webhooks in the
// dashboard) configured on the `items` table for UPDATE events, POSTing
// here with { type, table, record, old_record }. This is the actual
// mechanism behind "text alerts fire automatically" — it fires for every
// path that changes an item's count (Quick Log, Closing Count, a sales
// import, even a future admin edit), not just ones the app remembers to
// call explicitly.

const STATUS_RANK: Record<Status, number> = { good: 0, low: 1, critical: 2 };
const STATUS_LABEL: Record<"low" | "critical", string> = { low: "Reorder Soon", critical: "Critical" };

function getStatus(count: number, threshold: number): Status {
  if (count <= threshold * 0.5) return "critical";
  if (count <= threshold) return "low";
  return "good";
}

interface ItemRow {
  id: number;
  shop_id: string;
  name: string;
  count: number;
  threshold: number;
  unit: string;
}

export async function POST(request: Request) {
  const secret = request.headers.get("x-alerts-secret");
  if (!secret || secret !== process.env.ALERTS_WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid body." }, { status: 400 });
  }

  const { type, record, old_record } = (payload ?? {}) as {
    type?: string;
    record?: ItemRow;
    old_record?: ItemRow;
  };

  if (type !== "UPDATE" || !record || !old_record) {
    return NextResponse.json({ ok: true, skipped: "not an item update" });
  }

  const oldStatus = getStatus(old_record.count, old_record.threshold);
  const newStatus = getStatus(record.count, record.threshold);

  // Only a strictly worsening crossing fires a text — never on
  // improvement, and never repeatedly while it just sits at the same
  // status (e.g. every single Quick Log click on an already-critical item).
  if (newStatus === "good" || STATUS_RANK[newStatus] <= STATUS_RANK[oldStatus]) {
    return NextResponse.json({ ok: true, skipped: "not a worsening crossing" });
  }

  const supabase = getSupabaseAdmin();
  const { data: recipients, error } = await supabase
    .from("alert_recipients")
    .select("phone")
    .eq("shop_id", record.shop_id);

  if (error) {
    console.error("Couldn't load alert recipients:", error);
    return NextResponse.json({ error: "Couldn't load recipients." }, { status: 500 });
  }
  if (!recipients || recipients.length === 0) {
    return NextResponse.json({ ok: true, sent: 0, reason: "no recipients configured" });
  }

  let accountSid: string;
  let authToken: string;
  let fromNumber: string;
  try {
    accountSid = getTwilioAccountSid();
    authToken = getTwilioAuthToken();
    fromNumber = getTwilioPhoneNumber();
  } catch (err) {
    console.error("Twilio isn't configured:", err);
    return NextResponse.json({ error: "SMS isn't configured yet." }, { status: 500 });
  }

  const body = `Ground Work: ${record.name} is now ${STATUS_LABEL[newStatus]} — ${record.count} ${record.unit} left (threshold ${record.threshold}).`;

  const results = await Promise.all(
    (recipients as { phone: string }[]).map(({ phone }) =>
      fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({ To: phone, From: fromNumber, Body: body }),
      })
    )
  );

  const failed = results.filter((r) => !r.ok).length;
  if (failed > 0) {
    console.error(`${failed} of ${recipients.length} restock alert texts failed to send.`);
  }

  return NextResponse.json({ ok: true, sent: recipients.length - failed, failed });
}
