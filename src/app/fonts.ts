import localFont from "next/font/local";

// Self-hosted (no build-time network): Inter for UI, JetBrains Mono for queries and IDs.
export const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "400 600",
  variable: "--font-inter",
  // optional: preloaded, Inter is nearly always there for the first paint; if it is late, the size-adjusted
  // fallback stays for that page view instead of swapping (a swap re-lays out text and restarts LCP).
  display: "optional",
  preload: true,
});

export const jetbrains = localFont({
  src: "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  weight: "400 600",
  variable: "--font-jetbrains",
  display: "swap",
  preload: false,
});
