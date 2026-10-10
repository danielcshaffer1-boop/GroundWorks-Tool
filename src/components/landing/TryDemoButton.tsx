"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { DEMO_EMAIL, DEMO_PASSWORD } from "@/lib/demo";

// Signs the visitor into the shared demo shop, then navigates to "/" and
// refreshes so the server re-renders with the new session cookie and serves
// the app instead of the landing page.
export function TryDemoButton({ className, children }: { className?: string; children: React.ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function openDemo() {
    setBusy(true);
    setError("");
    try {
      const { error: signInError } = await createClient().auth.signInWithPassword({
        email: DEMO_EMAIL,
        password: DEMO_PASSWORD,
      });
      if (signInError) {
        setError("Couldn't load the demo. Try again in a moment.");
        setBusy(false);
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex flex-col items-start gap-2">
      <button type="button" onClick={openDemo} disabled={busy} className={className}>
        {busy ? "Opening the demo…" : children}
      </button>
      {error && (
        <span role="alert" className="text-sm" style={{ color: "var(--gw-danger-text)" }}>
          {error}
        </span>
      )}
    </span>
  );
}
