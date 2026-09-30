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
      style={{ backgroundColor: "#1B1512", fontFamily: "'Inter', sans-serif" }}
    >
      <div
        className="w-full max-w-sm rounded-lg border p-6"
        style={{ borderColor: "#3A2F27", backgroundColor: "#211A15" }}
      >
        <div className="font-mono text-xs uppercase tracking-[0.25em] mb-2" style={{ color: "#C1663B" }}>
          GroundWorks
        </div>
        <h1
          style={{
            fontFamily: "'Barlow Condensed', sans-serif",
            color: "#EDE3D3",
            fontSize: 28,
            fontWeight: 700,
            letterSpacing: "0.01em",
          }}
          className="mb-1"
        >
          SET NEW PASSWORD
        </h1>

        {status === "checking" && (
          <p className="text-xs mt-4" style={{ color: "#9C8C79" }}>
            Verifying your reset link…
          </p>
        )}

        {status === "invalid" && (
          <>
            <p className="text-xs mt-4 mb-4" style={{ color: "#9C8C79" }}>
              This reset link is invalid or has expired. Request a new one from the sign-in screen.
            </p>
            <Link
              href="/"
              className="block w-full text-center px-4 py-2.5 rounded-md text-sm font-mono font-semibold"
              style={{ backgroundColor: "#C1663B", color: "#1B1512" }}
            >
              Back to sign in
            </Link>
          </>
        )}

        {status === "updated" && (
          <p className="text-xs mt-4" style={{ color: "#7A8F5E" }}>
            Password updated. Taking you to your dashboard…
          </p>
        )}

        {status === "ready" && (
          <form onSubmit={handleSubmit}>
            <p className="text-xs mb-5 mt-1" style={{ color: "#9C8C79" }}>
              Choose a new password for your account.
            </p>

            <label className="block text-xs font-mono mb-1.5" style={{ color: "#9C8C79" }}>
              New password
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              className="w-full rounded-md border px-3 py-2 mb-4 bg-transparent focus:outline-none"
              style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
            />

            <label className="block text-xs font-mono mb-1.5" style={{ color: "#9C8C79" }}>
              Confirm new password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              autoComplete="new-password"
              className="w-full rounded-md border px-3 py-2 mb-2 bg-transparent focus:outline-none"
              style={{ borderColor: "#5A4A3C", color: "#EDE3D3" }}
            />

            {error && (
              <div className="text-xs font-mono mt-2" style={{ color: "#B0492F" }}>
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full mt-5 px-4 py-2.5 rounded-md text-sm font-mono font-semibold disabled:opacity-60"
              style={{ backgroundColor: "#C1663B", color: "#1B1512" }}
            >
              {busy ? "Working…" : "Update Password"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
