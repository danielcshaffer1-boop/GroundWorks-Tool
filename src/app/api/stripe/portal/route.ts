import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
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
  } catch {
    return NextResponse.json({ error: "Couldn't open billing portal. Try again." }, { status: 500 });
  }
}
