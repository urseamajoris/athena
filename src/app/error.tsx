"use client";
import { useEffect } from "react";
import { PublicBar } from "@/components/AppChrome";
import { Button, ButtonLink } from "@/components/ui";

/** Any page that throws keeps a way back instead of the browser's blank error page. */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => console.error(error), [error]);
  return (
    <div className="min-h-screen bg-bg-0">
      <PublicBar />
      <main id="main" className="mx-auto max-w-2xl px-4 py-16 md:px-6">
        <h1 className="text-headline font-semibold">This page could not load</h1>
        <p className="mt-2 text-fg-1">Your work is saved. Try again, or go back to your reviews.</p>
        <div className="mt-8 flex flex-wrap gap-2">
          <Button variant="primary" onClick={reset}>Try again</Button>
          <ButtonLink href="/sessions">Go to my reviews</ButtonLink>
        </div>
        {error.digest && <p className="mt-8 text-small text-fg-2">If you report this, give this reference: {error.digest}</p>}
      </main>
    </div>
  );
}
