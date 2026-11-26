import InventoryTracker from "@/components/InventoryTracker";
import Landing from "@/components/landing/Landing";
import SupportChat from "@/components/SupportChat";
import { DEMO_SHOP_ID } from "@/lib/demo";
import { createClient } from "@/lib/supabase/server";

// Signed-in visitors get the app; everyone else gets the landing page. The
// answer depends on the request's auth cookies, so this is never prerendered.
// (Stripe's success/cancel URLs and the password-reset flow all return a
// signed-in user to "/", which is why the app stays here and the marketing
// page is the one that yields.)
export const dynamic = "force-dynamic";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return <Landing />;

  // The help chat calls a paid API, so the shared public demo doesn't get it.
  return (
    <>
      <InventoryTracker />
      {user.id !== DEMO_SHOP_ID && <SupportChat />}
    </>
  );
}
