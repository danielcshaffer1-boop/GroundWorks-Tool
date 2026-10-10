import type { Metadata, Viewport } from "next";
import { Barlow_Condensed, Inter, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

// Self-hosted at build time (no third-party font request on a phone's cell
// connection) and exposed as CSS variables that globals.css maps onto the
// app's display / body / mono stacks.
const barlow = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  variable: "--font-barlow",
  display: "swap",
});
// Inter is a variable font: no explicit weight list, or Turbopack's font
// loader fails the production build ("queries have exactly one entry").
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});
const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "GroundWorks Inventory",
  description: "Shift-ticket style back-of-house inventory tracker for coffee shops.",
  // iOS home-screen name and a solid status bar that matches the app.
  appleWebApp: { capable: true, title: "GroundWorks", statusBarStyle: "black" },
};

// Matches the page background so the phone's status bar / browser chrome
// blends in instead of showing a white strip above the app.
export const viewport: Viewport = {
  themeColor: "#1b1512",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`h-full antialiased ${barlow.variable} ${inter.variable} ${plexMono.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
