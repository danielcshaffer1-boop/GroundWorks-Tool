// Where the app is willing to send the browser after a server call: Stripe
// (checkout, billing portal) and Square (connecting an account). The URLs come
// from our own routes, so this is a safety net — a surprising value (another
// host, or a javascript: link) is refused instead of followed.
const TRUSTED_HOSTS = ["stripe.com", "squareup.com", "squareupsandbox.com"];

export function isTrustedRedirect(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "https:" && TRUSTED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  } catch {
    return false;
  }
}

// Navigates to `url` when it's trusted; returns false (and does nothing) otherwise.
export function goToTrustedUrl(url: string): boolean {
  if (!isTrustedRedirect(url)) return false;
  window.location.href = url;
  return true;
}
