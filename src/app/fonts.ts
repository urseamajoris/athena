import localFont from "next/font/local";

// Self-hosted (no build-time network): Inter for UI, JetBrains Mono for queries and IDs.
export const inter = localFont({
  src: "../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2",
  weight: "400 600",
  variable: "--font-inter",
  display: "swap",
  preload: true,
});

export const jetbrains = localFont({
  src: "../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2",
  weight: "400 600",
  variable: "--font-jetbrains",
  display: "swap",
  preload: false,
});
