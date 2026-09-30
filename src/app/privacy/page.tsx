import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Privacy Policy — GroundWorks Inventory",
  description: "How GroundWorks Inventory collects, uses, and protects information for its SMS restock alert service.",
};

const sectionHeading = "font-mono text-xs uppercase tracking-widest mt-8 mb-2";
const sectionHeadingStyle = { color: "#C1663B" };
const body = "text-sm leading-relaxed mb-2";
const bodyStyle = { color: "#EDE3D3" };

export default function PrivacyPolicyPage() {
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
          Privacy Policy
        </h1>
        <p className="font-mono text-xs uppercase tracking-widest mb-6" style={{ color: "#6E6153" }}>
          SMS restock alert service
        </p>

        <p className={body} style={bodyStyle}>
          This Privacy Policy describes how GroundWorks Inventory and Daniel Shaffer (&ldquo;we,&rdquo;
          &ldquo;us,&rdquo; or &ldquo;our&rdquo;) collects, uses, and protects information in connection with our
          SMS/text message restock alert service (the &ldquo;Service&rdquo;), offered as an add-on to GroundWorks,
          our paid inventory management application (the &ldquo;App&rdquo;).
        </p>

        <h2 className={sectionHeading} style={sectionHeadingStyle}>1. Information We Collect</h2>
        <p className={body} style={bodyStyle}>To provide the Service, we collect and store:</p>
        <ul className="list-disc pl-5 text-sm leading-relaxed mb-2 space-y-1" style={bodyStyle}>
          <li>Mobile phone number — provided by you when you opt in to text alerts.</li>
          <li>
            Account information — your App account ID and associated inventory/product data needed to determine
            which items you&rsquo;ve asked to be notified about (e.g., product SKUs, stock thresholds).
          </li>
          <li>Message delivery data — timestamps, delivery status, and opt-in/opt-out records for compliance purposes.</li>
          <li>
            Carrier information — your mobile carrier may be identified automatically to route messages; we do not
            access other data on your device.
          </li>
        </ul>
        <p className={body} style={bodyStyle}>
          We do not collect precise location data, and we do not access the contents of your phone, contacts, or
          other apps.
        </p>

        <h2 className={sectionHeading} style={sectionHeadingStyle}>2. How We Use Your Information</h2>
        <p className={body} style={bodyStyle}>We use the information above solely to:</p>
        <ul className="list-disc pl-5 text-sm leading-relaxed mb-2 space-y-1" style={bodyStyle}>
          <li>Send restock alert text messages for the products or thresholds you configure in the App.</li>
          <li>Confirm opt-in and process opt-out (STOP) or help (HELP) requests.</li>
          <li>Troubleshoot delivery issues and maintain service reliability.</li>
          <li>Comply with legal and carrier requirements (e.g., TCPA, CTIA guidelines).</li>
        </ul>
        <p className={body} style={bodyStyle}>
          We do not use your phone number for marketing unrelated to restock alerts, and we do not sell, rent, or
          share your phone number with third parties for their own marketing purposes.
        </p>

        <h2 className={sectionHeading} style={sectionHeadingStyle}>3. How You Consent and Opt In</h2>
        <p className={body} style={bodyStyle}>
          You opt in to the Service by entering your phone number in the App&rsquo;s notification settings and
          confirming via a one-time confirmation text. By opting in, you consent to receive automated text messages
          related to restock alerts at the number provided. Consent is not a condition of purchasing or using the
          App itself.
        </p>

        <h2 className={sectionHeading} style={sectionHeadingStyle}>4. Message Frequency and Charges</h2>
        <p className={body} style={bodyStyle}>
          Message frequency varies based on your configured alerts and product restock activity. Message and data
          rates may apply depending on your mobile carrier and plan. We are not responsible for carrier charges.
        </p>

        <h2 className={sectionHeading} style={sectionHeadingStyle}>5. Opting Out</h2>
        <p className={body} style={bodyStyle}>You may opt out of text alerts at any time by:</p>
        <ul className="list-disc pl-5 text-sm leading-relaxed mb-2 space-y-1" style={bodyStyle}>
          <li>Replying STOP to any alert text, or</li>
          <li>Disabling text notifications in your App account settings.</li>
        </ul>
        <p className={body} style={bodyStyle}>
          After opting out, you will receive one final confirmation message and no further alerts unless you opt in
          again. Reply HELP to any message for assistance, or contact us at{" "}
          <a href="mailto:danielcshaffer1@gmail.com" className="underline" style={{ color: "#EDE3D3" }}>
            danielcshaffer1@gmail.com
          </a>
          .
        </p>

        <h2 className={sectionHeading} style={sectionHeadingStyle}>6. Third-Party Service Providers</h2>
        <p className={body} style={bodyStyle}>
          We use a third-party SMS gateway/platform, Twilio, to deliver text messages. This provider processes your
          phone number and message content solely to transmit messages on our behalf and is contractually
          restricted from using your data for any other purpose. We do not share your inventory or business data
          with the SMS provider beyond what&rsquo;s needed to generate the alert text itself.
        </p>

        <h2 className={sectionHeading} style={sectionHeadingStyle}>7. Data Retention</h2>
        <p className={body} style={bodyStyle}>
          We retain your phone number and opt-in/opt-out records for as long as your App account is active, and for
          a reasonable period afterward as required to demonstrate consent compliance. You may request deletion of
          this data as described in Section 9.
        </p>

        <h2 className={sectionHeading} style={sectionHeadingStyle}>8. Data Security</h2>
        <p className={body} style={bodyStyle}>
          We use industry-standard safeguards (such as encryption in transit and access controls) to protect your
          phone number and related data from unauthorized access, disclosure, or misuse.
        </p>

        <h2 className={sectionHeading} style={sectionHeadingStyle}>9. Your Rights</h2>
        <p className={body} style={bodyStyle}>You may:</p>
        <ul className="list-disc pl-5 text-sm leading-relaxed mb-2 space-y-1" style={bodyStyle}>
          <li>Request access to the phone number and alert data we hold about you.</li>
          <li>Request correction or deletion of that data.</li>
          <li>Withdraw consent at any time (see Section 5).</li>
        </ul>
        <p className={body} style={bodyStyle}>
          To exercise these rights, contact us at{" "}
          <a href="mailto:danielcshaffer1@gmail.com" className="underline" style={{ color: "#EDE3D3" }}>
            danielcshaffer1@gmail.com
          </a>
          .
        </p>

        <h2 className={sectionHeading} style={sectionHeadingStyle}>10. Children&rsquo;s Privacy</h2>
        <p className={body} style={bodyStyle}>
          The Service is not directed to individuals under 18, and we do not knowingly collect phone numbers from
          minors.
        </p>

        <h2 className={sectionHeading} style={sectionHeadingStyle}>11. Changes to This Policy</h2>
        <p className="text-sm leading-relaxed mb-10" style={bodyStyle}>
          We may update this Privacy Policy from time to time. Material changes will be communicated via the App or
          by email. Continued use of the Service after changes take effect constitutes acceptance of the revised
          policy.
        </p>
      </div>
    </main>
  );
}
