import InventoryTracker from "@/components/InventoryTracker";

// This page's content depends entirely on who's signed in (or isn't), via
// Supabase Auth checked client-side in InventoryTracker. Never prerender it
// statically at build time.
export const dynamic = "force-dynamic";

export default function Home() {
  return <InventoryTracker />;
}
