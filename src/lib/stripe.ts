import Stripe from "stripe";

// Server-only. STRIPE_SECRET_KEY must never be prefixed NEXT_PUBLIC_ and
// must never be imported from a client component.

let client: Stripe | null = null;

export function getStripe(): Stripe {
  if (client) return client;
  const secretKey = process.env.STRIPE_SECRET_KEY;
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not set.");
  }
  client = new Stripe(secretKey);
  return client;
}

export type PlanId = "standard" | "pro";

export function priceIdForPlan(plan: PlanId): string {
  const priceId =
    plan === "standard" ? process.env.STRIPE_PRICE_STANDARD : process.env.STRIPE_PRICE_PRO;
  if (!priceId) {
    throw new Error(`Missing price id env var for plan "${plan}".`);
  }
  return priceId;
}

// The reverse lookup — given a Stripe Price id from a webhook event, which
// of our plans does it correspond to? Returns null for an unrecognized
// price (e.g. one removed from Stripe, or from an unrelated product).
export function planForPriceId(priceId: string): PlanId | null {
  if (priceId === process.env.STRIPE_PRICE_STANDARD) return "standard";
  if (priceId === process.env.STRIPE_PRICE_PRO) return "pro";
  return null;
}
