import "server-only";
import { countPaidCall, parseBudget, resolveMode, type PaidCalls } from "./paid-guard";
import { MODEL_PRICES } from "./ai/cost";
import { parseEffort } from "./ai/request";

const mode = resolveMode(process.env);

function num(v: string | undefined, d: number) {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : d;
}

const DEFAULT_MODEL = "claude-opus-5-5";

export const config = {
  /** ATHENA_ENV=production: the live deployment. Whether AI runs depends on the API key, not on this flag. */
  production: mode.production,
  /** The Anthropic API key from the environment. An admin can set another in the dashboard, which then wins. */
  anthropicApiKey: (process.env.ANTHROPIC_API_KEY ?? "").trim(),
  /** Where model requests go. ANTHROPIC_BASE_URL is not read: other programs on the machine may set it. */
  anthropicBaseUrl: process.env.ATHENA_ANTHROPIC_BASE_URL?.trim() || "https://api.anthropic.com",
  openalexApiKey: process.env.OPENALEX_API_KEY ?? "",
  ncbiApiKey: process.env.NCBI_API_KEY ?? "",
  contactEmail: process.env.CONTACT_EMAIL ?? "",
  models: {
    /** Scoping, question drafts, search building, ranking. */
    fast: process.env.ANTHROPIC_MODEL_FAST?.trim() || DEFAULT_MODEL,
    /** Per-paper summary rows. */
    summary: process.env.ANTHROPIC_MODEL_SUMMARY?.trim() || process.env.ANTHROPIC_MODEL_FAST?.trim() || DEFAULT_MODEL,
    /** Article analysis, synthesis, final questions. */
    reasoning: process.env.ANTHROPIC_MODEL_REASONING?.trim() || DEFAULT_MODEL,
  },
  /**
   * How hard the model works on an answer (low | medium | high | xhigh | max): it sets how much the model
   * thinks, and thinking is billed as output. Empty = send none and use the model's own default.
   */
  effort: {
    /** The fast and summary roles. */
    fast: parseEffort(process.env.AI_EFFORT_FAST, "low"),
    /** The reasoning role. */
    reasoning: parseEffort(process.env.AI_EFFORT_REASONING, "medium"),
  },
  /** The most output tokens one answer may use, thinking included. Answers are streamed, so a high limit is safe. */
  maxOutputTokens: 64_000,
  /** Server-wide cap on total recorded AI spend, in USD. 0 = no cap. An admin can set another in the dashboard. */
  budgetUsd: parseBudget(process.env.AI_BUDGET_USD),
  aiConcurrency: Math.max(1, num(process.env.AI_CONCURRENCY, 4)),
  maxResultsPerQuery: Math.max(1, num(process.env.MAX_RESULTS_PER_QUERY, 40)),
  appraisalMaxChars: num(process.env.APPRAISAL_MAX_CHARS, 60000),
  cacheTtlHours: num(process.env.HTTP_CACHE_TTL_HOURS, 168),
  simulateFailure: (process.env.SIMULATE_SOURCE_FAILURE ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  databasePath: process.env.DATABASE_PATH || "data/athena.db",
  /** USD per million tokens (input, cache write, cache read, output) per model; the table and its source are in ai/cost.ts. */
  pricing: MODEL_PRICES,
};

export type ModelRole = keyof typeof config.models;

/** The effort level for a role's calls, or null to send none. */
export const effortFor = (role: ModelRole) => (role === "reasoning" ? config.effort.reasoning : config.effort.fast);

const g = globalThis as unknown as { __paidCalls?: PaidCalls };
/** Every call to a paid API (the AI model, OpenAlex) since the server started; tests run with no keys and expect zero. */
export const paidCalls = (g.__paidCalls ??= { attempted: 0, blocked: 0 });

/** Call immediately before any network request to a paid API. Counts it for the admin telemetry; never throws. */
export function countPaid() {
  countPaidCall(paidCalls);
}
