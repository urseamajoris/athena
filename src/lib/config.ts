import "server-only";
import { countPaidCall, resolveMode, type PaidCalls } from "./paid-guard";
import { isAiProvider, PROVIDER_META, type AiProvider, type ModelRole } from "./shared/ai-providers";

const mode = resolveMode(process.env);

function num(v: string | undefined, d: number) {
  const n = Number(v);
  return v !== undefined && v !== "" && Number.isFinite(n) ? n : d;
}

function resolveDefaultProvider(env: Record<string, string | undefined>): AiProvider {
  const explicit = env.AI_PROVIDER?.trim().toLowerCase();
  if (isAiProvider(explicit)) return explicit;
  if (env.XAI_API_KEY?.trim()) return "xai";
  if (env.ANTHROPIC_API_KEY?.trim()) return "anthropic";
  if (env.GEMINI_API_KEY?.trim() || env.GOOGLE_API_KEY?.trim()) return "gemini";
  return "xai";
}

export const config = {
  /** ATHENA_ENV=production: the live deployment. Whether AI runs depends on the active provider's API key, not on this flag. */
  production: mode.production,
  defaultProvider: resolveDefaultProvider(process.env),
  xaiApiKey: process.env.XAI_API_KEY ?? "",
  xaiBaseUrl: process.env.XAI_BASE_URL || "https://api.x.ai/v1",
  anthropicApiKey: process.env.ANTHROPIC_API_KEY ?? "",
  anthropicBaseUrl: process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com/v1",
  geminiApiKey: process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY ?? "",
  geminiBaseUrl: process.env.GEMINI_BASE_URL || "https://generativelanguage.googleapis.com/v1beta",
  openalexApiKey: process.env.OPENALEX_API_KEY ?? "",
  ncbiApiKey: process.env.NCBI_API_KEY ?? "",
  contactEmail: process.env.CONTACT_EMAIL ?? "",
  models: {
    fast: process.env.XAI_MODEL_FAST || "grok-4.3",
    summary: process.env.XAI_MODEL_SUMMARY || process.env.XAI_MODEL_FAST || "grok-4.3",
    reasoning: process.env.XAI_MODEL_REASONING || "grok-4.3",
  },
  providerModels: {
    anthropic: {
      fast: process.env.ANTHROPIC_MODEL_FAST || PROVIDER_META.anthropic.defaultModels.fast,
      summary: process.env.ANTHROPIC_MODEL_SUMMARY || process.env.ANTHROPIC_MODEL_FAST || PROVIDER_META.anthropic.defaultModels.summary,
      reasoning: process.env.ANTHROPIC_MODEL_REASONING || PROVIDER_META.anthropic.defaultModels.reasoning,
    },
    gemini: {
      fast: process.env.GEMINI_MODEL_FAST || PROVIDER_META.gemini.defaultModels.fast,
      summary: process.env.GEMINI_MODEL_SUMMARY || process.env.GEMINI_MODEL_FAST || PROVIDER_META.gemini.defaultModels.summary,
      reasoning: process.env.GEMINI_MODEL_REASONING || PROVIDER_META.gemini.defaultModels.reasoning,
    },
    xai: {
      fast: process.env.XAI_MODEL_FAST || PROVIDER_META.xai.defaultModels.fast,
      summary: process.env.XAI_MODEL_SUMMARY || process.env.XAI_MODEL_FAST || PROVIDER_META.xai.defaultModels.summary,
      reasoning: process.env.XAI_MODEL_REASONING || PROVIDER_META.xai.defaultModels.reasoning,
    },
  } as Record<AiProvider, Record<ModelRole, string>>,
  fastReasoningEffort: process.env.XAI_FAST_REASONING_EFFORT ?? "low",
  /** Effort for the reasoning role (appraisal, synthesis, questions). Low keeps thinking tokens, billed as output, small. */
  reasoningEffort: process.env.XAI_REASONING_EFFORT ?? "low",
  budgetUsd: num(process.env.XAI_BUDGET_USD, 5),
  /** Starting literature-review credits granted to newly created accounts. */
  defaultUserCredits: Math.max(0, Math.round(num(process.env.DEFAULT_USER_CREDITS, 100))),
  /** Stripe Checkout secret key (server-side only) for literature-review credit top-ups. */
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? "",
  /** Stripe webhook signing secret (whsec_...) for verifying checkout.session.completed events. */
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? "",
  stripeApiBaseUrl: process.env.STRIPE_API_BASE_URL || "https://api.stripe.com/v1",
  /** Optional pre-configured Stripe Payment Link URLs per pack (used when STRIPE_SECRET_KEY is not set). */
  stripePaymentLinks: {
    starter: process.env.STRIPE_PAYMENT_LINK_STARTER ?? "",
    researcher: process.env.STRIPE_PAYMENT_LINK_RESEARCHER ?? "",
    lab: process.env.STRIPE_PAYMENT_LINK_LAB ?? "",
    department: process.env.STRIPE_PAYMENT_LINK_DEPARTMENT ?? "",
  } as Record<string, string>,
  aiConcurrency: Math.max(1, num(process.env.AI_CONCURRENCY, 4)),
  maxResultsPerQuery: Math.max(1, num(process.env.MAX_RESULTS_PER_QUERY, 40)),
  appraisalMaxChars: num(process.env.APPRAISAL_MAX_CHARS, 60000),
  cacheTtlHours: num(process.env.HTTP_CACHE_TTL_HOURS, 168),
  simulateFailure: (process.env.SIMULATE_SOURCE_FAILURE ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  databasePath: process.env.DATABASE_PATH || "data/athena.db",
  /**
   * Tests set this false so a missing key fails the job instead of pausing it. There is no mock responder:
   * a true value does not invent model output, and production leaves it false.
   */
  mockAi: process.env.MOCK_MODE === "true",
  /** USD per 1M tokens, used only when the API does not report cost. */
  pricing: {
    default: { input: 1.25, cachedInput: 0.2, output: 2.5 },
    ...Object.fromEntries(Object.values(PROVIDER_META).flatMap((p) => p.catalog.map((m) => [m.id, m.pricing]))),
  } as Record<string, { input: number; cachedInput: number; output: number }>,
};

export type { AiProvider, ModelRole };

export function envKeyFor(provider: AiProvider): string {
  if (provider === "anthropic") return config.anthropicApiKey;
  if (provider === "gemini") return config.geminiApiKey;
  return config.xaiApiKey;
}

const g = globalThis as unknown as { __paidCalls?: PaidCalls };
/** Every call to a paid API (AI providers, OpenAlex) since the server started; tests run with no keys and expect zero. */
export const paidCalls = (g.__paidCalls ??= { attempted: 0, blocked: 0 });

/** Call immediately before any network request to a paid API. Counts it for the admin telemetry; never throws. */
export function countPaid() {
  countPaidCall(paidCalls);
}
