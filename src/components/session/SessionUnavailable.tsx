"use client";
import { ApiError } from "../api";
import { PageShell } from "../AppChrome";
import { ButtonLink, ErrorState } from "../ui";

/**
 * A review that cannot be opened. "Not found" covers both a wrong link and another person's review (the server
 * answers the same for both, on purpose), so it never says which; other errors can be retried.
 */
export function SessionUnavailable({ error, retry }: { error: unknown; retry: () => void }) {
  const missing = error instanceof ApiError && error.status === 404;
  return (
    <PageShell width="narrow">
      {missing ? (
        <>
          <h1 className="text-headline font-semibold">This review could not be opened</h1>
          <p className="mt-2 text-fg-1">The link may be wrong, or the review belongs to another account. Your own reviews are in My reviews.</p>
        </>
      ) : (
        <ErrorState error={error} onRetry={retry} title="This review could not be opened" />
      )}
      <ButtonLink variant="primary" href="/sessions" className="mt-6">Go to my reviews</ButtonLink>
    </PageShell>
  );
}
