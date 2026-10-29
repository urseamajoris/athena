// Shared, dependency-free run-mode rules and the paid-call counter. Kept out of config.ts (which is server-only)
// so they can be unit-tested directly.

export interface RunMode {
  /** ATHENA_ENV=production: the live deployment. Paid calls depend on the keys, not on this flag. */
  production: boolean;
}

export function resolveMode(env: Record<string, string | undefined>): RunMode {
  return { production: (env.ATHENA_ENV ?? "").trim().toLowerCase() === "production" };
}

/**
 * What a paid-API request was: an xAI model call (one per attempt, so retries count, the same rows as the ai_calls
 * log), an admin's "Test key" (xAI's free model list), or an OpenAlex request made with an API key.
 */
export type PaidKind = "ai" | "keyTest" | "openalex";

/** Calls to paid APIs (xAI, OpenAlex) since the server started. Nothing blocks a call here, so blocked stays 0. */
export interface PaidCalls {
  attempted: number;
  blocked: number;
  byKind: Record<PaidKind, number>;
}

export const emptyPaidCalls = (): PaidCalls => ({ attempted: 0, blocked: 0, byKind: { ai: 0, keyTest: 0, openalex: 0 } });

/**
 * Counts one paid call for the admin telemetry. Never throws: whether AI runs is decided by the xAI key, the
 * admin's AI switch and the budget, all checked before the call.
 */
export function countPaidCall(calls: PaidCalls, kind: PaidKind) {
  calls.attempted++;
  calls.byKind ??= emptyPaidCalls().byKind; // a counter created before the breakdown existed (dev reload)
  calls.byKind[kind] = (calls.byKind[kind] ?? 0) + 1;
}
