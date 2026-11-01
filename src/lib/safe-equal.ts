import { createHash, timingSafeEqual } from "crypto";

// Compares two secrets in constant time. Hashing both first means differing
// lengths don't leak through an early return either. An unset secret never
// matches: callers pass `process.env.X ?? ""` and an empty expected value is
// always rejected.
export function safeEqual(actual: string | null | undefined, expected: string | null | undefined): boolean {
  if (!actual || !expected) return false;
  const digest = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(digest(actual), digest(expected));
}

// `Authorization: Bearer $CRON_SECRET`, as Vercel Cron sends it.
export function hasCronSecret(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  return safeEqual(request.headers.get("authorization"), secret ? `Bearer ${secret}` : null);
}
