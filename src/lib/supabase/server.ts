import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Server Component / Route Handler / Server Action client. Reads the
// session from request cookies (kept fresh by src/middleware.ts) so
// server-side code sees the same signed-in user the browser does — this is
// what step 5's server-side tier check will run its queries through.
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Called from a Server Component render, where cookies can't be
            // written. Harmless as long as middleware.ts is refreshing the
            // session on every request, which it is.
          }
        },
      },
    }
  );
}
