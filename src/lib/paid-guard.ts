// Shared, dependency-free rules for when Athena may call a paid API. Kept out of config.ts
// (which is server-only) so the rules can be unit-tested directly.

/** Services that cost money per call: xAI (model calls) and OpenAlex (metered by API key). */
export type PaidService = "xai" | "openalex";

export interface RunMode {
  /** ATHENA_ENV=production. The only environment where paid calls are allowed. */
  production: boolean;
  /** Recorded HTTP fixtures + mock model. Default: on everywhere except production. */
  mockMode: boolean;
  /** Mock model only (real database HTTP). Implied by mockMode. */
  mockAi: boolean;
}

function flag(v: string | undefined): boolean | null {
  if (v === undefined || v.trim() === "") return null;
  return ["1", "true", "yes", "on"].includes(v.trim().toLowerCase());
}

export function resolveMode(env: Record<string, string | undefined>): RunMode {
  const production = (env.ATHENA_ENV ?? "").trim().toLowerCase() === "production";
  const mockMode = flag(env.MOCK_MODE) ?? !production;
  return { production, mockMode, mockAi: mockMode || (flag(env.MOCK_AI) ?? false) };
}

export class PaidApiBlockedError extends Error {
  constructor(public service: PaidService, what: string) {
    super(
      `Refusing a paid ${service === "xai" ? "xAI" : "OpenAlex"} call (${what}) outside production. ` +
        `Paid APIs only run with ATHENA_ENV=production; use MOCK_MODE (the default) for development, tests and QA.`,
    );
  }
}

/** Why this configuration must not start, or null if it is fine. */
export function startupProblem(mode: RunMode): string | null {
  if (mode.production) return null;
  if (!mode.mockMode) {
    return (
      "MOCK_MODE=false / MOCK_AI-only mode would call paid APIs (xAI, OpenAlex), but ATHENA_ENV is not 'production'. " +
      "Unset MOCK_MODE to run in mock mode, or set ATHENA_ENV=production if you really mean to spend money."
    );
  }
  return null;
}

/** Throws unless a paid call is allowed in this mode. */
export function assertPaidAllowed(mode: RunMode, service: PaidService, what: string) {
  if (!mode.production) throw new PaidApiBlockedError(service, what);
}
