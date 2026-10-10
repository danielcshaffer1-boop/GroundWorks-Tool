"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Status = "checking" | "ready" | "invalid" | "updated";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>("checking");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const supabase = createClient();

    // The recovery link logs the visitor into a short-lived session and
    // fires this event once Supabase's client finishes parsing it from the
    // URL. If that never fires (expired/already-used/tampered link), the
    // visitor is left on "checking" and shown the invalid-link state below.
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        setStatus("ready");
      }
    });

    const timeout = setTimeout(() => {
      setStatus((current) => (current === "checking" ? "invalid" : current));
    }, 5000);

    return () => {
      listener.subscription.unsubscribe();
      clearTimeout(timeout);
    };
  }, []);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError("");

    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setBusy(true);
    const supabase = createClient();
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) {
        setError(updateError.message);
        return;
      }
      setStatus("updated");
      setTimeout(() => router.push("/"), 1500);
    } catch {
      setError("Couldn't reach the server. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="min-h-screen w-full flex items-center justify-center px-5"
      style={{ backgroundColor: "var(--gw-bg)", fontFamily: "var(--font-sans)" }}
    >
      <div
        className="w-full max-w-sm rounded-lg border p-6"
        style={{ borderColor: "var(--gw-border)", backgroundColor: "var(--gw-surface)" }}
      >
        <div className="font-mono text-xs uppercase tracking-[0.25em] mb-2" style={{ color: "var(--gw-accent-text)" }}>
          GroundWorks
        </div>
        <h1
          style={{
            fontFamily: "var(--font-display)",
            color: "var(--gw-text)",
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "0.01em",
          }}
          className="mb-1"
        >
          SET NEW PASSWORD
        </h1>

        {status === "checking" && (
          <p className="text-xs mt-4" style={{ color: "var(--gw-text-2)" }}>
            Verifying your reset link…
          </p>
        )}

        {status === "invalid" && (
          <>
            <p className="text-xs mt-4 mb-4" style={{ color: "var(--gw-text-2)" }}>
              This reset link is invalid or has expired. Request a new one from the sign-in screen.
            </p>
            <Link
              href="/"
              className="block w-full text-center px-4 py-2.5 rounded-md text-sm font-mono font-semibold"
              style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
            >
              Back to sign in
            </Link>
          </>
        )}

        {status === "updated" && (
          <p className="text-xs mt-4" style={{ color: "var(--gw-ok)" }}>
            Password updated. Taking you to your dashboard…
          </p>
        )}

        {status === "ready" && (
          <form onSubmit={handleSubmit}>
            <p className="text-xs mb-5 mt-1" style={{ color: "var(--gw-text-2)" }}>
              Choose a new password for your account.
            </p>

            <label className="block text-xs font-mono mb-1.5" style={{ color: "var(--gw-text-2)" }}>
              New password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              className="w-full rounded-md border px-3 py-2 mb-4 bg-transparent focus:outline-none"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            />

            <label className="block text-xs font-mono mb-1.5" style={{ color: "var(--gw-text-2)" }}>
              Confirm new password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              className="w-full rounded-md border px-3 py-2 mb-2 bg-transparent focus:outline-none"
              style={{ borderColor: "var(--gw-border-strong)", color: "var(--gw-text)" }}
            />

            {error && (
              <div className="text-xs font-mono mt-2" style={{ color: "var(--gw-danger-text)" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full mt-5 px-4 py-2.5 rounded-md text-sm font-mono font-semibold disabled:opacity-60"
              style={{ backgroundColor: "var(--gw-accent)", color: "var(--gw-bg)" }}
            >
              {busy ? "Working…" : "Update Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
