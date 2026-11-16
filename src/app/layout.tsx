import type { Metadata, Viewport } from "next";
import "./globals.css";
import { inter, jetbrains } from "./fonts";
import { themeInitScript } from "@/lib/theme";
import { ClientErrorReporter } from "@/components/ClientErrorReporter";

export const metadata: Metadata = {
  title: "Athena: from a rough idea to a literature review",
  description: "Athena guides you from a rough research idea to a research question, real papers, and an analysis of each article.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#1a1a17" },
  ],
  colorScheme: "light dark",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${inter.variable} ${jetbrains.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
      </head>
      <body className="min-h-screen bg-bg-0 text-fg-0">
        <a href="#main" className="sr-only rounded-sm bg-bg-1 px-3 py-2 font-medium focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50">Skip to content</a>
        {children}
        <ClientErrorReporter />
      </body>
    </html>
  );
}
