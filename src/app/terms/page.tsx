import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Terms of Service — GroundWorks Inventory",
  description: "Terms and conditions for GroundWorks Inventory's SMS restock alert service.",
};

const body = "text-sm leading-relaxed mb-2";
const bodyStyle = { color: "#EDE3D3" };

export default function TermsOfServicePage() {
  return (
    <main className="min-h-screen px-6 py-10 sm:py-16" style={{ backgroundColor: "#1B1512" }}>
      <div className="max-w-2xl mx-auto">
        <Link
          href="/"
          className="font-mono text-xs uppercase tracking-widest"
          style={{ color: "#9C8C79" }}
        >
          &larr; GroundWorks Inventory
        </Link>

        <h1
          className="mt-4 mb-1"
          style={{ fontFamily: "'Barlow Condensed', sans-serif", color: "#EDE3D3", fontSize: 32, fontWeight: 700 }}
        >
          Terms of Service
        </h1>
        <p className="font-mono text-xs uppercase tracking-widest mb-1" style={{ color: "#6E6153" }}>
          Restock alert text messages
        </p>
        <p className="font-mono text-[10px] uppercase tracking-widest mb-6" style={{ color: "#6E6153" }}>
          Effective 8/29/2026
        </p>

        <p className={body} style={bodyStyle}>
          By opting in to SMS restock alerts (the &ldquo;Service&rdquo;) from GroundWorks Inventory as part of
          GroundWorks, you agree to the following:
        </p>

        <ol className="list-decimal pl-5 text-sm leading-relaxed space-y-3 mt-4" style={bodyStyle}>
          <li>
            <span className="font-semibold">Consent</span> — You consent to receive automated text messages about
            product restock alerts at the mobile number you provide. Consent is not required to purchase or use
            GroundWorks.
          </li>
          <li>
            <span className="font-semibold">Message Frequency</span> — Frequency varies based on your configured
            alerts and restock activity.
          </li>
          <li>
            <span className="font-semibold">Message and Data Rates</span> — Message and data rates may apply.
            Carrier charges are your responsibility.
          </li>
          <li>
            <span className="font-semibold">Opt-Out</span> — Reply STOP at any time to cancel. Reply HELP for
            assistance, or contact{" "}
            <a href="mailto:danielcshaffer1@gmail.com" className="underline" style={{ color: "#EDE3D3" }}>
              danielcshaffer1@gmail.com
            </a>
            .
          </li>
          <li>
            <span className="font-semibold">Supported Carriers</span> — Carriers are not liable for delayed or
            undelivered messages.
          </li>
          <li>
            <span className="font-semibold">Eligibility</span> — You must be 18 or older, or the account holder for
            the number provided, to opt in.
          </li>
          <li>
            <span className="font-semibold">Changes</span> — We may update these Terms or the Service at any time;
            continued use after changes means you accept the update.
          </li>
          <li>
            <span className="font-semibold">Privacy</span> — Use of your information is governed by our{" "}
            <Link href="/privacy" className="underline" style={{ color: "#EDE3D3" }}>
              Privacy Policy
            </Link>
            .
          </li>
        </ol>

        <p className="text-sm leading-relaxed mt-8 mb-10" style={bodyStyle}>
          Questions? Contact GroundWorks Inventory at{" "}
          <a href="mailto:danielcshaffer1@gmail.com" className="underline" style={{ color: "#EDE3D3" }}>
            danielcshaffer1@gmail.com
          </a>
          .
        </p>
      </div>
    </main>
  );
}
