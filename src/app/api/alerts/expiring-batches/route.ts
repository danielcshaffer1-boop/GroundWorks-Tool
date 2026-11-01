import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { DEMO_SHOP_ID } from "@/lib/demo";
import { hasCronSecret } from "@/lib/safe-equal";
import { alertablePhones, cleanForSms } from "@/lib/sms-text";
import { getTwilioAccountSid, getTwilioAuthToken, getTwilioPhoneNumber, sendSms } from "@/lib/twilio";

// Invoked once a day by Vercel Cron (see vercel.json) rather than firing
// on a database event like the restock alert route — nothing necessarily
// changes in the database on the day a batch happens to go bad, so this
// has to be a scheduled check instead of a trigger. Vercel signs cron
// requests with `Authorization: Bearer $CRON_SECRET` automatically once
// that env var is set on the project; verified below the same way the
// item-updated route verifies its webhook secret.

interface ShopMeta {
  expiration_alert_days: number;
  tier: string;
}

interface DueBatchRow {
  id: number;
  item_id: number;
  quantity: number;
  expires_on: string;
  label: string | null;
  items: {
    name: string;
    unit: string;
    shop_id: string;
    shops: ShopMeta | ShopMeta[];
  };
}

const PAGE_SIZE = 1000; // PostgREST's default row cap
const ID_CHUNK = 200; // keeps `.in()` lists well under URL length limits

function daysUntil(dateStr: string): number {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const target = new Date(dateStr + "T00:00:00Z");
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

function chunks<T>(list: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

export async function GET(request: Request) {
  if (!hasCronSecret(request)) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const supabase = getSupabaseAdmin();

  // Every not-yet-alerted batch, with just enough of its item/shop to
  // decide (per-shop lead time) and to compose the text. Filtering by
  // each shop's own expiration_alert_days happens in JS below — it's not
  // a fixed value, so it can't be pushed into the query itself. Read a page
  // at a time, because one request returns at most 1,000 rows.
  const batches: DueBatchRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("batches")
      .select(
        "id, item_id, quantity, expires_on, label, items!inner(name, unit, shop_id, shops!inner(expiration_alert_days, tier))"
      )
      .eq("expiration_alert_sent", false)
      .order("id")
      .range(from, from + PAGE_SIZE - 1);
    if (error) {
      console.error("Couldn't load batches for the expiration check:", error);
      return NextResponse.json({ error: "Couldn't load batches." }, { status: 500 });
    }
    batches.push(...((data ?? []) as unknown as DueBatchRow[]));
    if (!data || data.length < PAGE_SIZE) break;
  }

  const dueByShop = new Map<
    string,
    { batchId: number; name: string; quantity: number; unit: string; expiresOn: string; label: string | null }[]
  >();

  for (const row of batches) {
    const shopMeta = Array.isArray(row.items.shops) ? row.items.shops[0] : row.items.shops;
    // A shop without an active plan (cancelled, or never subscribed) isn't texted.
    if (shopMeta?.tier !== "standard" && shopMeta?.tier !== "pro") continue;
    const leadDays = shopMeta?.expiration_alert_days ?? 3;
    if (daysUntil(row.expires_on) > leadDays) continue;

    const shopId = row.items.shop_id;
    // See item-updated: the shared demo shop never sends texts.
    if (shopId === DEMO_SHOP_ID) continue;
    const list = dueByShop.get(shopId) ?? [];
    list.push({
      batchId: row.id,
      name: row.items.name,
      quantity: row.quantity,
      unit: row.items.unit,
      expiresOn: row.expires_on,
      label: row.label,
    });
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
  const sendFailures: string[] = [];

  for (const [shopId, dueBatches] of dueByShop) {
    const phones = alertablePhones(recipientsByShop.get(shopId) ?? []);
    if (phones.length === 0) {
      shopsSkippedNoRecipients++;
      continue;
    }

    // Claim the batches before texting: flip the flag only on rows that are
    // still unalerted and keep the ids that actually flipped. If two runs
    // overlap, the second finds nothing left to claim and sends nothing.
    const claimed: number[] = [];
    let claimFailed = false;
    for (const ids of chunks(dueBatches.map((b) => b.batchId), ID_CHUNK)) {
      const { data, error } = await supabase
        .from("batches")
        .update({ expiration_alert_sent: true })
        .in("id", ids)
        .eq("expiration_alert_sent", false)
        .select("id");
      if (error) {
        console.error("Couldn't claim batches for an expiration text:", error);
        claimFailed = true;
        break;
      }
      claimed.push(...(data ?? []).map((r) => r.id as number));
    }
    const claimedSet = new Set(claimed);
    const toSend = dueBatches.filter((b) => claimedSet.has(b.batchId));

    const release = async () => {
      for (const ids of chunks(claimed, ID_CHUNK)) {
        await supabase.from("batches").update({ expiration_alert_sent: false }).in("id", ids);
      }
    };

    if (claimFailed || toSend.length === 0) {
      if (claimed.length > 0) await release();
      continue;
    }

    // One text per shop per run, not one per batch — a shop with several
    // things expiring at once shouldn't get spammed.
    const lines = toSend
      .map(
        (b) =>
          `${cleanForSms(b.name, 40)}${b.label ? ` (${cleanForSms(b.label, 30)})` : ""}: ${Number(b.quantity)} ${cleanForSms(b.unit, 20)} (expires ${b.expiresOn})`
      )
      .join("; ");
    const body = `GroundWorks Inventory: ${toSend.length} batch${toSend.length === 1 ? "" : "es"} expiring soon — ${lines}. Reply STOP to opt out.`;

    const results = await Promise.all(phones.map((phone) => sendSms(phone, body).catch(() => ({ ok: false }))));
    if (!results.some((r) => r.ok)) {
      // Nobody got it: put the batches back so tomorrow's run tries again.
      sendFailures.push(shopId);
      await release();
      continue;
    }

    shopsAlerted++;
  }

  return NextResponse.json({
    ok: true,
    shopsAlerted,
    shopsSkippedNoRecipients,
    sendFailures: sendFailures.length,
  });
}
