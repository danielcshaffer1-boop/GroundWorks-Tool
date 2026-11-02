import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanForSms } from "@/lib/sms-text";
import { sendSms } from "@/lib/twilio";

// The wording the owner agreed to when they added the number. It is stored on
// the recipient row as part of the consent record, so keep it in step with the
// checkbox text in the Alerts tab and bump CONSENT_VERSION when either changes.
export const CONSENT_VERSION = "2026-11-02";
export const CONSENT_TEXT =
  "I confirm this is my number, or that its owner agreed to receive automated inventory text alerts from GroundWorks Inventory. The number will get one text asking it to reply YES before any alerts start. Message frequency varies. Msg & data rates may apply. Reply STOP to opt out, HELP for help.";

// Limits on confirmation texts, so adding and removing a number over and over
// can't be used to text someone repeatedly.
const PER_PHONE_GAP_MS = 10 * 60 * 1000;
const PER_PHONE_DAILY = 3;
const PER_SHOP_DAILY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

export function confirmationBody(shopName: string): string {
  return `GroundWorks Inventory: ${cleanForSms(shopName, 40)} added this number. Opt in to restock notifications by replying YES. Msg & data rates may apply. Reply STOP to opt out, HELP for help.`;
}

export type ConfirmationResult = { ok: true } | { ok: false; status: number; error: string };

// Sends the "reply YES" text to a pending recipient, subject to the limits
// above, and records it. The caller has already checked who is asking.
export async function sendConfirmationText(
  admin: SupabaseClient,
  opts: { shopId: string; shopName: string; phone: string }
): Promise<ConfirmationResult> {
  const since = new Date(Date.now() - DAY_MS).toISOString();
  const [{ data: phoneLog }, { count: shopCount }] = await Promise.all([
    admin.from("consent_request_log").select("sent_at").eq("phone", opts.phone).gte("sent_at", since).order("sent_at", { ascending: false }),
    admin.from("consent_request_log").select("id", { count: "exact", head: true }).eq("shop_id", opts.shopId).gte("sent_at", since),
  ]);
  const recent = phoneLog ?? [];
  if (recent[0] && Date.now() - new Date(recent[0].sent_at as string).getTime() < PER_PHONE_GAP_MS) {
    return { ok: false, status: 429, error: "A confirmation text was just sent to that number. Give it a few minutes before sending another." };
  }
  if (recent.length >= PER_PHONE_DAILY) {
    return { ok: false, status: 429, error: "That number has already been sent several confirmation texts today. Try again tomorrow." };
  }
  if ((shopCount ?? 0) >= PER_SHOP_DAILY) {
    return { ok: false, status: 429, error: "Too many confirmation texts today. Try again tomorrow." };
  }

  let res: Response;
  try {
    res = await sendSms(opts.phone, confirmationBody(opts.shopName));
  } catch (err) {
    console.error("Couldn't send a confirmation text:", err);
    return { ok: false, status: 502, error: "Couldn't send the confirmation text. Try again in a moment." };
  }
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { code?: number } | null;
    console.error(`Twilio refused a confirmation text (code ${detail?.code ?? "?"}).`);
    // 21610: the number replied STOP to us before and Twilio blocks it until it replies START.
    if (detail?.code === 21610) {
      return { ok: false, status: 422, error: "That number opted out of GroundWorks texts earlier. Ask them to text START to our number, then add it again." };
    }
    return { ok: false, status: 422, error: "Twilio couldn't send a text to that number. Check it and try again." };
  }

  await admin.from("consent_request_log").insert({ shop_id: opts.shopId, phone: opts.phone });
  return { ok: true };
}
