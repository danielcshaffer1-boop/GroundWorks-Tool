import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, planForPriceId } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

// The only place in this app that writes shops.tier/stripe_* — everywhere
// else those columns are revoked from the authenticated role (see
// supabase/005_paid_tiers.sql). Authenticated here by Stripe's signature,
// not a Supabase session, since Stripe calls this server-to-server.
export async function POST(request: Request) {
  const signature = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!signature || !webhookSecret) {
    return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  }

  // Signature verification needs the exact raw body bytes — never parse
  // this as JSON before constructEvent runs.
  const rawBody = await request.text();

  let stripe;
  let event: Stripe.Event;
  try {
    stripe = getStripe();
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return NextResponse.json({ error: `Invalid signature: ${(err as Error).message}` }, { status: 400 });
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
        const subscription = await stripe.subscriptions.retrieve(subscriptionId);
        const priceId = subscription.items.data[0]?.price.id;
        const plan = priceId ? planForPriceId(priceId) : null;

        await supabase
          .from("shops")
          .update({
            tier: plan ?? "none",
            stripe_customer_id:
              typeof session.customer === "string" ? session.customer : (session.customer?.id ?? null),
            stripe_subscription_id: subscription.id,
            subscription_status: subscription.status,
          })
          .eq("id", shopId);
        break;
      }

      // Renewals, upgrades/downgrades via the billing portal, and payment
      // failures all land here as a status/price change on the same
      // subscription object.
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const shopId = subscription.metadata?.shopId;
        if (!shopId) break;

        const priceId = subscription.items.data[0]?.price.id;
        const plan = priceId ? planForPriceId(priceId) : null;
        const isActive = subscription.status === "active" || subscription.status === "trialing";

        await supabase
          .from("shops")
          .update({
            tier: isActive && plan ? plan : "none",
            stripe_subscription_id: subscription.id,
            subscription_status: subscription.status,
          })
          .eq("id", shopId);
        break;
      }

      // Fully canceled (not just past-due) — revoke access.
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const shopId = subscription.metadata?.shopId;
        if (!shopId) break;

        await supabase
          .from("shops")
          .update({ tier: "none", subscription_status: "canceled" })
          .eq("id", shopId);
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
