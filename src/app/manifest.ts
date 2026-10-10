import type { MetadataRoute } from "next";

// Lets a shop add GroundWorks to a phone's home screen as a standalone app
// (no browser bar). The icon artwork keeps its mark inside the central ~64%,
// so it survives the rounded/circular crops Android applies to maskable icons.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "GroundWorks Inventory",
    short_name: "GroundWorks",
    description: "Shift-ticket style back-of-house inventory tracker for coffee shops.",
    start_url: "/",
    display: "standalone",
    background_color: "#1b1512",
    theme_color: "#1b1512",
    icons: [
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icon-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
