import type { NextConfig } from "next";

// The only outside service the browser itself talks to is Supabase (sign-in and
// the shop data). Stripe and Square are reached by full-page navigation, and
// Twilio is called from the server, so none of them need to be listed here.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseSocket = supabaseUrl.replace(/^https:/, "wss:");
const isDev = process.env.NODE_ENV !== "production";

// 'unsafe-inline' stays for scripts and styles because Next injects small
// inline scripts and the app styles elements with style="…". The policy still
// blocks every outside script, framing of the app, plugins and <base> tricks.
const appCsp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseUrl} ${supabaseSocket}${isDev ? " ws://localhost:* http://localhost:*" : ""}`.trim(),
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

// The training guides are static pages: inline styles, Google Fonts, images
// embedded as data: URIs, and no scripts at all.
const guidesCsp = [
  "default-src 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "script-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: appCsp },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // The training guides are plain static pages in public/guides. These give them
  // clean URLs (/guides, /guides/barista, /guides/owner) instead of ".html".
  async rewrites() {
    return [
      { source: "/guides", destination: "/guides/index.html" },
      { source: "/guides/barista", destination: "/guides/barista.html" },
      { source: "/guides/owner", destination: "/guides/owner.html" },
    ];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // Responses from our own API are per-user or one-off; never cache them.
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
      // The guides are for customers and their teams, not for search results.
      // Listed last so their own policy replaces the app-wide one.
      {
        source: "/guides/:path*",
        headers: [
          { key: "Content-Security-Policy", value: guidesCsp },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
