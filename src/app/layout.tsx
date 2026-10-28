import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { StatusPill } from "@/components/StatusPill";

export const metadata: Metadata = {
  title: "Athena — guided literature review",
  description: "A guided literature-review prototype for novice researchers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:bg-white focus:px-3 focus:py-2 focus:rounded">Skip to content</a>
        <header className="border-b border-[var(--color-line)] bg-white/80 backdrop-blur sticky top-0 z-30">
          <div className="mx-auto flex h-12 max-w-[1600px] items-center justify-between px-4">
            <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight text-gray-900">
              <span aria-hidden className="inline-block h-6 w-6 rounded-md bg-[var(--color-accent)] text-center text-sm leading-6 text-white">A</span>
              Athena <span className="hidden font-normal text-gray-500 sm:inline">· guided literature review</span>
            </Link>
            <StatusPill />
          </div>
        </header>
        <div id="main">{children}</div>
      </body>
    </html>
  );
}
