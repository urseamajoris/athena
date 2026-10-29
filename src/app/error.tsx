"use client";
import Link from "next/link";
import { useEffect } from "react";
import { LogoMark } from "@/components/Logo";

/** Any page that throws keeps a way back instead of the browser's blank error page. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="min-h-screen bg-bg-0">
      <header className="flex h-12 items-center border-b border-line px-4">
        <Link href="/sessions" className="inline-flex h-11 items-center gap-2 font-semibold"><LogoMark /> Athena</Link>
      </header>
      <main id="main" className="mx-auto max-w-xl px-4 py-16">
        <h1 className="text-20 font-semibold">This page could not load</h1>
        <p className="mt-2 text-fg-1">Your work is saved. Try again, or go back to your projects.</p>
        <div className="mt-6 flex gap-2">
          <button className="btn-primary min-h-11" onClick={reset}>Try again</button>
          <Link href="/sessions" className="btn-secondary min-h-11">My projects</Link>
        </div>
        {error.digest && <p className="mt-6 text-12 text-fg-2">Reference: {error.digest}</p>}
      </main>
    </div>
  );
}
