import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The training guides are plain static pages in public/guides. These give them
  // clean URLs (/guides, /guides/barista, /guides/owner) instead of ".html".
  async rewrites() {
    return [
      { source: "/guides", destination: "/guides/index.html" },
      { source: "/guides/barista", destination: "/guides/barista.html" },
      { source: "/guides/owner", destination: "/guides/owner.html" },
    ];
  },
  // They are for customers and their teams, not for search results.
  async headers() {
    return [
      {
        source: "/guides/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
