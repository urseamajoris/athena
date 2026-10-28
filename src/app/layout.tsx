import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { inter, jetbrains } from "./fonts";
import { themeInitScript } from "@/lib/theme";
import { StatusPill } from "@/components/StatusPill";

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
        <header className="sticky top-0 z-30 border-b border-line bg-bg-0">
          <div className="mx-auto flex h-12 max-w-[1600px] items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold text-fg-0">
              <span aria-hidden className="inline-block h-6 w-6 rounded-sm border border-line-strong bg-bg-2 text-center text-12 leading-6">A</span>
              Athena <span className="hidden font-normal text-fg-2 sm:inline">· guided literature review</span>
            </Link>
            <StatusPill />
          </div>
        </header>
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
