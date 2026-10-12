import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

// Server-only helpers for the owner PIN. The PIN is a short number, so the
// hash alone would be guessable offline; the real protection is that the hash
// never leaves the server and wrong guesses lock the shop's PIN for a while
// (see MAX_ATTEMPTS / LOCKOUT_MS and /api/owner-pin).

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 5 * 60 * 1000;

export function isValidPin(pin: unknown): pin is string {
  return typeof pin === "string" && /^\d{4,6}$/.test(pin);
}

export function hashPin(pin: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(pin, salt, 32);
  return `${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPin(pin: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const salt = Buffer.from(saltHex, "hex");
  const expected = Buffer.from(hashHex, "hex");
  // Anything that isn't a well-formed hash must fail closed, never match.
  if (salt.length !== 16 || expected.length !== 32) return false;
  const actual = scryptSync(pin, salt, 32);
  return timingSafeEqual(actual, expected);
}
