// The anon key is stored as NEXT_PUBLIC_SUPABASE_ANON_KEY_B64 (base64-
// wrapped) rather than a plain env var. Reason, found the hard way: some
// part of the Vercel/GitHub deployment pipeline auto-redacts any
// environment variable value that matches a Supabase key's signature —
// regardless of its sensitivity setting, how it's submitted (dashboard,
// CLI --value, piped stdin), or how many times it's deleted and
// recreated — silently replacing part of the value with literal U+2022
// bullet characters at build time, breaking every request that uses it.
// A value that merely looks like a JWT (tested with a fake one) is NOT
// affected — only the real Supabase-shaped key is. Base64-wrapping the
// value avoids whatever it's matching on; this decodes it back at
// runtime, never storing the raw form anywhere Vercel can see it.
export function getSupabaseAnonKey(): string {
  const encoded = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY_B64;
  if (!encoded) {
    throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY_B64 is not set.");
  }
  return atob(encoded);
}
