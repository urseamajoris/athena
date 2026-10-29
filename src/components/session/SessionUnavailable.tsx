"use client";
import Link from "next/link";
import { LogoMark } from "../Logo";
import { ApiError } from "../api";
import { ErrorState } from "../ui";

/**
 * A review that cannot be opened. "Not found" covers both a wrong link and another person's review (the server
 * answers the same for both, on purpose), so it never says which; other errors can be retried.
 */
export function SessionUnavailable({ error, retry }: { error: unknown; retry: () => void }) {
  const missing = error instanceof ApiError && error.status === 404;
  return (
    <div className="min-h-screen bg-bg-0">
      <header className="flex h-12 items-center px-2 md:px-4">
        <Link href="/sessions" className="inline-flex h-11 items-center gap-2 rounded-sm px-1 font-semibold"><LogoMark /> My projects</Link>
      </header>
      <main id="main" className="mx-auto max-w-xl px-4 py-12">
        {missing ? (
          <>
            <h1 className="text-20 font-semibold">This review could not be opened</h1>
            <p className="mt-2 text-fg-1">The link may be wrong, or the review belongs to another account. Your own reviews are in My projects.</p>
          </>
        ) : (
          <ErrorState error={error} onRetry={retry} title="This review could not be opened" />
        )}
        <Link href="/sessions" className="btn-primary mt-6 min-h-11">Go to my projects</Link>
      </main>
    </div>
  );
}
