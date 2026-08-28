import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe, priceIdForPlan, type PlanId } from "@/lib/stripe";
import { DEMO_SHOP_ID } from "@/lib/demo";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  if (user.id === DEMO_SHOP_ID) {
    return NextResponse.json({ error: "Billing isn't available in the demo." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { plan } = (body ?? {}) as { plan?: unknown };
  if (plan !== "standard" && plan !== "pro") {
    return NextResponse.json({ error: "Invalid plan." }, { status: 400 });
  }

  // stripe_customer_id is readable by the owner (only UPDATE on it was
  // revoked in 005_paid_tiers.sql), so this plain authenticated read is
  // correctly scoped — no service-role client needed here.
  const { data: shop, error: shopError } = await supabase
    .from("shops")
    .select("id, stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  if (shopError || !shop) {
    return NextResponse.json({ error: "Couldn't find your shop." }, { status: 404 });
  }

  let stripe;
  try {
    stripe = getStripe();
  } catch {
    return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 500 });
  }

  const origin = request.nextUrl.origin;

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      line_items: [{ price: priceIdForPlan(plan as PlanId), quantity: 1 }],
      client_reference_id: shop.id,
      customer: shop.stripe_customer_id ?? undefined,
      customer_email: shop.stripe_customer_id ? undefined : (user.email ?? undefined),
      // Managed Payments (Stripe's automatic tax handling) requires every
      // product to have a tax code set, which is a real business decision
      // (where you're registered to collect sales tax, etc.) — not
      // something to default silently. Off for now; revisit deliberately
      // if/when you want Stripe handling tax.
      managed_payments: { enabled: false },
      // Metadata on the subscription itself (not just the session) is what
      // lets the webhook attribute later renewal/cancellation events back
      // to this shop — the session object isn't available by then.
      subscription_data: {
        metadata: { shopId: shop.id },
      },
      metadata: { shopId: shop.id },
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
    });

    if (!session.url) {
      return NextResponse.json({ error: "Couldn't start checkout." }, { status: 500 });
    }
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe checkout session creation failed:", err);
    return NextResponse.json({ error: "Couldn't start checkout. Try again." }, { status: 500 });
  }
}
