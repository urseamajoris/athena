// Shared, dependency-free run-mode rules, spend-cap rules and the paid-call counter. Kept out of config.ts (which
// is server-only) so they can be unit-tested directly.

export interface RunMode {
  /** ATHENA_ENV=production: the live deployment. Paid calls depend on the keys, not on this flag. */
  production: boolean;
}

export function resolveMode(env: Record<string, string | undefined>): RunMode {
  return { production: (env.ATHENA_ENV ?? "").trim().toLowerCase() === "production" };
}

/** Calls to paid APIs (the AI model, OpenAlex) since the server started. Nothing blocks a call here, so blocked stays 0. */
export interface PaidCalls {
  attempted: number;
  blocked: number;
}

/**
 * Counts one paid call for the admin telemetry. Never throws: whether AI runs is decided by the API key, the
 * admin's AI switch, the payer's credits and the budget, all checked before the call.
 */
export function countPaidCall(calls: PaidCalls) {
  calls.attempted++;
}

/**
 * The server-wide cap on total recorded AI spend, in USD, as written in AI_BUDGET_USD or sent by an admin.
 * 0 means "no cap": an empty, missing, negative or non-numeric value is 0.
 */
export function parseBudget(raw: string | number | null | undefined): number {
  const n = typeof raw === "number" ? raw : Number((raw ?? "").trim() || 0);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Is there a cap at all? A limit of 0 is "no cap". */
export const hasCap = (limitUsd: number) => Number.isFinite(limitUsd) && limitUsd > 0;

/** AI calls stop once recorded spend reaches the cap. With no cap they never stop for this reason. */
export function budgetReached(spentUsd: number, limitUsd: number): boolean {
  return hasCap(limitUsd) && spentUsd >= limitUsd;
}

/** Does limit `a` allow more spend than limit `b`? No cap allows more than any cap. */
export function allowsMoreThan(a: number, b: number): boolean {
  const room = (x: number) => (hasCap(x) ? x : Infinity);
  return room(a) > room(b);
}
