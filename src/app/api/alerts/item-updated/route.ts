import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getTwilioAccountSid, getTwilioAuthToken, getTwilioPhoneNumber } from "@/lib/twilio";
import { DEMO_SHOP_ID } from "@/lib/demo";
import { safeEqual } from "@/lib/safe-equal";
import { alertablePhones, cleanForSms } from "@/lib/sms-text";
import type { Status } from "@/lib/types";

// Called by a Supabase Database Webhook (Database -> Webhooks in the
// dashboard) configured on the `items` table for UPDATE events, POSTing
// here with { type, table, record, old_record }. This is the actual
// mechanism behind "text alerts fire automatically" — it fires for every
// path that changes an item's count (Quick Log, Closing Count, a sales
// import, even a future admin edit), not just ones the app remembers to
// call explicitly.

const STATUS_RANK: Record<Status, number> = { good: 0, low: 1, critical: 2 };

// An item that keeps bouncing around its threshold (restocked, used, restocked…)
// shouldn't text every time: the same status — or a milder one — isn't sent
// again for an item within this window. Getting worse (Low, then Critical)
// always goes out. Each shop is also capped on alert events per day, so a
// mistake or abuse can't turn into a flood of texts.
const COOLDOWN_MS = 2 * 60 * 60 * 1000;
const DAILY_EVENT_CAP = 40;
const LOG_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
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
  if (!safeEqual(request.headers.get("x-alerts-secret"), process.env.ALERTS_WEBHOOK_SECRET)) {
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

  // The public demo is shared by every visitor and anyone can type a phone
  // number into its Alerts tab, so it must never send a real text.
  if (record.shop_id === DEMO_SHOP_ID) {
    return NextResponse.json({ ok: true, skipped: "demo shop never sends texts" });
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
    .eq("shop_id", record.shop_id)
    .not("confirmed_at", "is", null); // only numbers that replied YES

  if (error) {
    console.error("Couldn't load alert recipients:", error);
    return NextResponse.json({ error: "Couldn't load recipients." }, { status: 500 });
  }
  const phones = alertablePhones(((recipients ?? []) as { phone: string }[]).map((r) => r.phone));
  if (phones.length === 0) {
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

  // Cooldown and daily cap (supabase/018_alert_send_log.sql). If the log can't
  // be read, send anyway: a missed restock alert costs more than a repeat.
  const [recentRes, dayRes] = await Promise.all([
    supabase
      .from("alert_send_log")
      .select("status")
      .eq("item_id", record.id)
      .gte("sent_at", new Date(Date.now() - COOLDOWN_MS).toISOString()),
    supabase
      .from("alert_send_log")
      .select("id", { count: "exact", head: true })
      .eq("shop_id", record.shop_id)
      .gte("sent_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()),
  ]);
  if (recentRes.error || dayRes.error) {
    console.error("Couldn't read the alert send log:", recentRes.error ?? dayRes.error);
  } else {
    const alreadySent = (recentRes.data ?? []).some((r) => STATUS_RANK[r.status as Status] >= STATUS_RANK[newStatus]);
    if (alreadySent) return NextResponse.json({ ok: true, skipped: "already texted about this item recently" });
    if ((dayRes.count ?? 0) >= DAILY_EVENT_CAP) {
      console.error(`Shop ${record.shop_id} hit the daily alert cap (${DAILY_EVENT_CAP}); not texting.`);
      return NextResponse.json({ ok: true, skipped: "daily alert limit reached" });
    }
  }

  // Record it before sending, so two near-simultaneous webhooks can't both send.
  const { data: logRow, error: logError } = await supabase
    .from("alert_send_log")
    .insert({ shop_id: record.shop_id, item_id: record.id, status: newStatus })
    .select("id")
    .single();
  if (logError) console.error("Couldn't record the alert in the send log:", logError);

  // Automatic Square deductions leave fractional counts (0.8734 gallons); texts read better rounded.
  const shownCount = Math.round(Number(record.count) * 100) / 100;
  const { data: shopRow } = await supabase.from("shops").select("name").eq("id", record.shop_id).maybeSingle();
  const shopName = cleanForSms(String(shopRow?.name ?? ""), 30);
  const body = `GroundWorks Inventory:${shopName ? ` ${shopName}:` : ""} ${cleanForSms(String(record.name), 40)} is now ${STATUS_LABEL[newStatus]} - ${shownCount} ${cleanForSms(String(record.unit), 20)} left (threshold ${Number(record.threshold)}). Reply STOP to opt out.`;

  const results = await Promise.all(
    phones.map((phone) =>
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
    console.error(`${failed} of ${phones.length} restock alert texts failed to send.`);
  }
  // Nobody received it: don't let a failed send count against the cooldown.
  if (failed === phones.length && logRow) {
    await supabase.from("alert_send_log").delete().eq("id", logRow.id);
  }
  await supabase.from("alert_send_log").delete().lt("sent_at", new Date(Date.now() - LOG_KEEP_MS).toISOString());

  return NextResponse.json({ ok: true, sent: phones.length - failed, failed });
}
