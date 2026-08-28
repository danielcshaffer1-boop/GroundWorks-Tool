import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { DEMO_SHOP_ID } from "@/lib/demo";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  // shops.id IS the auth user id — enforced here regardless of whether the
  // client-side button is hidden, since this is the actual boundary that
  // keeps a public demo visitor away from real Stripe billing UI.
  if (user.id === DEMO_SHOP_ID) {
    return NextResponse.json({ error: "Billing isn't available in the demo." }, { status: 403 });
  }

  const { data: shop, error: shopError } = await supabase
    .from("shops")
    .select("stripe_customer_id")
    .eq("id", user.id)
    .maybeSingle();

  if (shopError || !shop?.stripe_customer_id) {
    return NextResponse.json({ error: "No billing account found for this shop yet." }, { status: 404 });
  }

  let stripe;
  try {
    stripe = getStripe();
  } catch {
    return NextResponse.json({ error: "Billing isn't configured yet." }, { status: 500 });
  }

  const origin = request.nextUrl.origin;

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: shop.stripe_customer_id,
      return_url: `${origin}/`,
    });
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("Stripe billing portal session creation failed:", err);
    return NextResponse.json({ error: "Couldn't open billing portal. Try again." }, { status: 500 });
  }
}
