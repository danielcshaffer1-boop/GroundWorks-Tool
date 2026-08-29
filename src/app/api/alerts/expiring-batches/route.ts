import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { getTwilioAccountSid, getTwilioAuthToken, getTwilioPhoneNumber, sendSms } from "@/lib/twilio";

// Invoked once a day by Vercel Cron (see vercel.json) rather than firing
// on a database event like the restock alert route — nothing necessarily
// changes in the database on the day a batch happens to go bad, so this
// has to be a scheduled check instead of a trigger. Vercel signs cron
// requests with `Authorization: Bearer $CRON_SECRET` automatically once
// that env var is set on the project; verified below the same way the
// item-updated route verifies its webhook secret.

interface DueBatchRow {
  id: number;
  item_id: number;
  quantity: number;
  expires_on: string;
  items: {
    name: string;
    unit: string;
    shop_id: string;
    shops: { expiration_alert_days: number } | { expiration_alert_days: number }[];
  };
}

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00Z");
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

export async function GET(request: Request) {
  const auth = request.headers.get("authorization");
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  // Every not-yet-alerted batch, with just enough of its item/shop to
  // decide (per-shop lead time) and to compose the text. Filtering by
  // each shop's own expiration_alert_days happens in JS below — it's not
  // a fixed value, so it can't be pushed into the query itself.
  const { data: batches, error } = await supabase
    .from("batches")
    .select("id, item_id, quantity, expires_on, items!inner(name, unit, shop_id, shops!inner(expiration_alert_days))")
    .eq("expiration_alert_sent", false);

  if (error) {
    console.error("Couldn't load batches for the expiration check:", error);
    return NextResponse.json({ error: "Couldn't load batches." }, { status: 500 });
  }

  const dueByShop = new Map<string, { batchId: number; name: string; quantity: number; unit: string; expiresOn: string }[]>();

  for (const row of (batches ?? []) as unknown as DueBatchRow[]) {
    const shopMeta = Array.isArray(row.items.shops) ? row.items.shops[0] : row.items.shops;
    const leadDays = shopMeta?.expiration_alert_days ?? 3;
    if (daysUntil(row.expires_on) > leadDays) continue;

    const shopId = row.items.shop_id;
    const list = dueByShop.get(shopId) ?? [];
    list.push({ batchId: row.id, name: row.items.name, quantity: row.quantity, unit: row.items.unit, expiresOn: row.expires_on });
    dueByShop.set(shopId, list);
  }

  if (dueByShop.size === 0) {
    return NextResponse.json({ ok: true, shopsAlerted: 0, reason: "nothing due" });
  }

  try {
    getTwilioAccountSid();
    getTwilioAuthToken();
    getTwilioPhoneNumber();
  } catch (err) {
    console.error("Twilio isn't configured:", err);
    return NextResponse.json({ error: "SMS isn't configured yet." }, { status: 500 });
  }

  const { data: recipientRows, error: recipientError } = await supabase
    .from("alert_recipients")
    .select("shop_id, phone")
    .in("shop_id", Array.from(dueByShop.keys()));

  if (recipientError) {
    console.error("Couldn't load alert recipients for expiration texts:", recipientError);
    return NextResponse.json({ error: "Couldn't load recipients." }, { status: 500 });
  }

  const recipientsByShop = new Map<string, string[]>();
  for (const r of (recipientRows ?? []) as { shop_id: string; phone: string }[]) {
    const list = recipientsByShop.get(r.shop_id) ?? [];
    list.push(r.phone);
    recipientsByShop.set(r.shop_id, list);
  }

  let shopsAlerted = 0;
  let shopsSkippedNoRecipients = 0;
  const alertedBatchIds: number[] = [];
  const sendFailures: string[] = [];

  for (const [shopId, dueBatches] of dueByShop) {
    const phones = recipientsByShop.get(shopId);
    if (!phones || phones.length === 0) {
      shopsSkippedNoRecipients++;
      continue;
    }

    // One text per shop per run, not one per batch — a shop with several
    // things expiring at once shouldn't get spammed.
    const lines = dueBatches
      .map((b) => `${b.name}: ${b.quantity} ${b.unit} (expires ${b.expiresOn})`)
      .join("; ");
    const body = `Ground Work: ${dueBatches.length} batch${dueBatches.length === 1 ? "" : "es"} expiring soon — ${lines}.`;

    const results = await Promise.all(phones.map((phone) => sendSms(phone, body)));
    const anySucceeded = results.some((r) => r.ok);
    if (!anySucceeded) {
      sendFailures.push(shopId);
      continue;
    }

    shopsAlerted++;
    alertedBatchIds.push(...dueBatches.map((b) => b.batchId));
  }

  if (alertedBatchIds.length > 0) {
    const { error: markError } = await supabase
      .from("batches")
      .update({ expiration_alert_sent: true })
      .in("id", alertedBatchIds);
    if (markError) {
      console.error("Sent expiration texts but couldn't mark batches as alerted:", markError);
    }
  }

  return NextResponse.json({
    ok: true,
    shopsAlerted,
    shopsSkippedNoRecipients,
    sendFailures: sendFailures.length,
  });
}
