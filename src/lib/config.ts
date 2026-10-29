import "server-only";
import { countPaidCall, emptyPaidCalls, resolveMode, type PaidCalls, type PaidKind } from "./paid-guard";

const mode = resolveMode(process.env);

function num(v: string | undefined, d: number) {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : d;
}

export const config = {
  /** ATHENA_ENV=production: the live deployment. Whether AI runs depends on the xAI key, not on this flag. */
  production: mode.production,
  xaiApiKey: process.env.XAI_API_KEY ?? "",
  xaiBaseUrl: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
  openalexApiKey: process.env.OPENALEX_API_KEY ?? "",
  ncbiApiKey: process.env.NCBI_API_KEY ?? "",
  contactEmail: process.env.CONTACT_EMAIL ?? "",
  models: {
    fast: process.env.XAI_MODEL_FAST || "grok-4.3",
    summary: process.env.XAI_MODEL_SUMMARY || process.env.XAI_MODEL_FAST || "grok-4.3",
    reasoning: process.env.XAI_MODEL_REASONING || "grok-4.20-0309-reasoning",
  },
  fastReasoningEffort: process.env.XAI_FAST_REASONING_EFFORT ?? "low",
  budgetUsd: num(process.env.XAI_BUDGET_USD, 5),
  aiConcurrency: Math.max(1, num(process.env.AI_CONCURRENCY, 4)),
  maxResultsPerQuery: Math.max(1, num(process.env.MAX_RESULTS_PER_QUERY, 40)),
  appraisalMaxChars: num(process.env.APPRAISAL_MAX_CHARS, 60000),
  cacheTtlHours: num(process.env.HTTP_CACHE_TTL_HOURS, 168),
  simulateFailure: (process.env.SIMULATE_SOURCE_FAILURE ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  databasePath: process.env.DATABASE_PATH || "data/athena.db",
  /** USD per 1M tokens, used only when the API does not report cost. Source: docs.x.ai/docs/models (Oct 2026). */
  pricing: {
    default: { input: 1.25, cachedInput: 0.2, output: 2.5 },
  } as Record<string, { input: number; cachedInput: number; output: number }>,
};

export type ModelRole = keyof typeof config.models;

const g = globalThis as unknown as { __paidCalls?: PaidCalls };
/** Every call to a paid API (xAI, OpenAlex) since the server started; tests run with no keys and expect zero. */
export const paidCalls = (g.__paidCalls ??= emptyPaidCalls());

/** Call immediately before any network request to a paid API. Counts it for the admin telemetry; never throws. */
export function countPaid(kind: PaidKind) {
  countPaidCall(paidCalls, kind);
}
