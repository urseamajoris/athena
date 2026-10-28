import type { Metadata, Viewport } from "next";
import "./globals.css";
import { inter, jetbrains } from "./fonts";
import { themeInitScript } from "@/lib/theme";
import { RouteTransitions } from "@/components/vt";

export const metadata: Metadata = {
  title: "Athena — guided literature review",
  description: "A guided literature-review prototype for novice researchers.",
};

export const viewport: Viewport = {
  themeColor: "#0a0a0b",
  colorScheme: "dark light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark" className={`${inter.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-bg-0 text-fg-0">
        <a href="#main" className="sr-only rounded-sm bg-bg-2 px-3 py-2 focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50">Skip to content</a>
        {children}
        <RouteTransitions />
      </body>
    </html>
  );
}
