import "server-only";

function bool(v: string | undefined, d = false) {
  if (v === undefined || v === "") return d;
  return ["1", "true", "yes", "on"].includes(v.toLowerCase());
}
function num(v: string | undefined, d: number) {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : d;
}

export const config = {
  mockMode: bool(process.env.MOCK_MODE),
  /** Mock only the model (real HTTP). Implied by MOCK_MODE. Useful for zero-cost pipeline tests and for recording fixtures. */
  mockAi: bool(process.env.MOCK_MODE) || bool(process.env.MOCK_AI),
  recordFixtures: bool(process.env.RECORD_FIXTURES),
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
