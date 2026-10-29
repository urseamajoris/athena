// Shared by server pages and client components (no Node APIs here).

/** Only same-site paths are honoured as ?next= targets (no open redirect). */
export function safeNext(next: string | null | undefined, fallback = "/sessions") {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : fallback;
}
