import { NextResponse } from "next/server";
import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getStripe, planForPriceId } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// The only place in this app that writes shops.tier/stripe_* — everywhere
// else those columns are closed to the browser (see supabase/016_shops_lockdown.sql).
// Authenticated here by Stripe's signature, not a Supabase session, since
// Stripe calls this server-to-server.

// A subscription in one of these states still entitles the shop to access
// (or is mid-retry), so a *different* subscription's events must not
// overwrite it.
const LIVE_STATUSES = new Set(["active", "trialing", "past_due", "unpaid"]);

// A shop keeps its plan while Stripe is still retrying a failed card
// (`past_due`): one declined payment shouldn't lock a shop out of its own
// inventory. Access ends when Stripe gives up and cancels the subscription
// (or marks it unpaid), which arrives here as a later event.
const KEEPS_ACCESS = new Set(["active", "trialing", "past_due"]);

// Brings the shop row in line with what Stripe says about one subscription
// *right now*. Events can arrive late, twice, or out of order, so every
// handler re-reads the subscription instead of trusting the event payload.
async function syncSubscription(
  supabase: SupabaseClient,
  stripe: Stripe,
  shopId: string,
  subscriptionId: string,
  customerId?: string | null
) {
  const subscription = await stripe.subscriptions
    .retrieve(subscriptionId)
    .catch((err: { code?: string }) => (err?.code === "resource_missing" ? null : Promise.reject(err)));

  const { data: shop } = await supabase
    .from("shops")
    .select("tier, stripe_subscription_id, subscription_status")
    .eq("id", shopId)
    .maybeSingle();
  if (!shop) return;

  // Another subscription already holds this shop's access (for example a
  // second one that was started by mistake): ignore this one's events, so
  // cancelling it can't lock out a shop that is still paying.
  if (
    shop.stripe_subscription_id &&
    shop.stripe_subscription_id !== subscriptionId &&
    LIVE_STATUSES.has(shop.subscription_status ?? "")
  ) {
    return;
  }

  if (!subscription) {
    await supabase.from("shops").update({ tier: "none", subscription_status: "canceled" }).eq("id", shopId);
    return;
  }

  const priceId = subscription.items.data[0]?.price.id;
  const plan = priceId ? planForPriceId(priceId) : null;
  const isActive = KEEPS_ACCESS.has(subscription.status);
  if (isActive && !plan) console.error(`Stripe subscription ${subscription.id} has an unrecognised price; leaving the tier unchanged.`);

  const update: Record<string, string | null> = {
    stripe_subscription_id: subscription.id,
    subscription_status: subscription.status,
  };
  if (!isActive) update.tier = "none";
  else if (plan) update.tier = plan;
  if (customerId) update.stripe_customer_id = customerId;

  await supabase.from("shops").update(update).eq("id", shopId);
}

export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }
  if (!signature) {
    return NextResponse.json({ error: "Missing signature." }, { status: 400 });
  }

  // Signature verification needs the exact raw body bytes — never parse
  // this as JSON before constructEvent runs.
  const rawBody = await request.text();

  let stripe;
  let event: Stripe.Event;
  try {
    stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    return NextResponse.json({ error: "Invalid signature." }, { status: 400 });
  }

  const supabase = getSupabaseAdmin();

  try {
    switch (event.type) {
      // Fires once at the end of a successful Checkout — this is what
      // turns a brand-new subscription into shop access for the first time.
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const shopId = session.client_reference_id ?? session.metadata?.shopId;
        if (!shopId || !session.subscription) break;

        const subscriptionId =
          typeof session.subscription === "string" ? session.subscription : session.subscription.id;
        const customerId = typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null);
        await syncSubscription(supabase, stripe, shopId, subscriptionId, customerId);
        break;
      }

      // Renewals, upgrades/downgrades via the billing portal, payment
      // failures and full cancellation all land here as a status/price
      // change on the same subscription object.
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const shopId = subscription.metadata?.shopId;
        if (!shopId) break;
        await syncSubscription(supabase, stripe, shopId, subscription.id);
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error("Stripe webhook handler error:", err);
    return NextResponse.json({ error: "Webhook handler failed." }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
