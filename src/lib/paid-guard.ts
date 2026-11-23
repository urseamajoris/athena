// Shared, dependency-free run-mode rules and the paid-call counter. Kept out of config.ts (which is server-only)
// so they can be unit-tested directly.

export interface RunMode {
  /** ATHENA_ENV=production: the live deployment. Paid calls depend on the keys, not on this flag. */
  production: boolean;
}

export function resolveMode(env: Record<string, string | undefined>): RunMode {
  return { production: (env.ATHENA_ENV ?? "").trim().toLowerCase() === "production" };
}

/** Calls to paid APIs (xAI, OpenAlex) since the server started. Nothing blocks a call here, so blocked stays 0. */
export interface PaidCalls {
  attempted: number;
  blocked: number;
}

/**
 * Counts one paid call for the admin telemetry. Never throws: whether AI runs is decided by the xAI key, the
 * admin's AI switch and the budget, all checked before the call.
 */
export function countPaidCall(calls: PaidCalls) {
  calls.attempted++;
}
