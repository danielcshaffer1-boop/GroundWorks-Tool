import type { Metadata } from "next";
import { redirect } from "next/navigation";
import InventoryTracker from "@/components/InventoryTracker";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Sign in | GroundWorks Inventory" };
export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  return <InventoryTracker initialAuthMode="sign-in" />;
}
