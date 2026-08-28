// The public, deliberately shared demo account — the "Try the demo" button
// on LoginScreen signs anyone into this same real shop. Billing surfaces
// are explicitly blocked for this one shop id, both client-side (buttons
// hidden/disabled) and server-side (route handlers reject it outright) —
// a public demo should never be able to reach Stripe, regardless of how
// it's reached, not just because a button happens to be hidden.
export const DEMO_SHOP_ID = "87b8a70e-358b-4e34-875a-96913196d8da";
