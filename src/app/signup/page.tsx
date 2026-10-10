import type { Metadata } from "next";
import { redirect } from "next/navigation";
import InventoryTracker from "@/components/InventoryTracker";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Create your shop | GroundWorks Inventory" };
export const dynamic = "force-dynamic";

export default async function SignupPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) redirect("/");

  return <InventoryTracker initialAuthMode="sign-up" />;
}
