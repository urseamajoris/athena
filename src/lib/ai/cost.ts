// What a model call costs. The API reports tokens, not dollars, so the cost is worked out here from the usage
// object and a price table. Dependency-free so the arithmetic is unit-tested directly.

/** USD per million tokens. */
export interface Rates {
  /** Prompt tokens that were neither read from nor written to the prompt cache. */
  input: number;
  /** Prompt tokens written to the cache (5-minute entries: 1.25 x input). */
  cacheWrite: number;
  /** Prompt tokens read from the cache. */
  cacheRead: number;
  /** Output tokens, thinking included. */
  output: number;
}
export interface ModelPrice extends Rates {
  /** Rates for a request whose whole prompt is longer than `overTokens`. */
  longPrompt?: Rates & { overTokens: number };
}

/**
 * Anthropic first-party API prices, USD per million tokens. Source: the "Model pricing" table at
 * https://platform.claude.com/docs/en/about-claude/pricing, read on 2026-11-16 (columns: base input tokens,
 * 5m cache writes, cache hits and refreshes, output tokens). This app only makes 5-minute cache entries. A
 * model missing from the table is costed at the Claude Opus 5.5 rates.
 */
export const MODEL_PRICES: Record<string, ModelPrice> = {
  "claude-opus-5-5": { input: 4, cacheWrite: 5, cacheRead: 0.2, output: 20 },
  "claude-sonnet-5-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.1, output: 10 },
  "claude-haiku-5-5": { input: 0.1, cacheWrite: 0.125, cacheRead: 0.01, output: 0.5, longPrompt: { overTokens: 100_000, input: 0.5, cacheWrite: 0.625, cacheRead: 0.05, output: 2.5 } },
  "claude-fable-5-2": { input: 8, cacheWrite: 10, cacheRead: 0.2, output: 40 },
  // The models a declined request can be re-run on (see REFUSAL_FALLBACK_MODELS), so those runs are costed too.
  "claude-opus-5": { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  "claude-opus-4-8": { input: 5, cacheWrite: 6.25, cacheRead: 0.5, output: 25 },
  "claude-sonnet-5": { input: 2, cacheWrite: 2.5, cacheRead: 0.2, output: 10 },
};
export const DEFAULT_PRICE_MODEL = "claude-opus-5-5";

/** The price row for a model ID: an exact match, else the longest listed ID it starts with, else the default. */
export function priceFor(model: string, prices: Record<string, ModelPrice> = MODEL_PRICES): ModelPrice {
  if (prices[model]) return prices[model];
  const base = Object.keys(prices).filter((id) => model.startsWith(`${id}-`)).sort((a, b) => b.length - a.length)[0];
  return prices[base ?? DEFAULT_PRICE_MODEL];
}

/** The token counts of one model run, as the Messages API reports them. */
export interface TokenCounts {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}
/** The `usage` object of a response (the fields used here). */
export interface ApiUsage extends TokenCounts {
  output_tokens_details?: { thinking_tokens: number } | null;
  /** One entry per model run inside the request. Present when a declined request was re-run on another model. */
  iterations?: (TokenCounts & { type: string; model?: string | null })[] | null;
}

/** What is stored on an ai_calls row. */
export interface CallCost {
  /** Every prompt token: uncached + read from the cache + written to the cache. */
  inputTokens: number;
  /** Prompt tokens read from the cache. */
  cachedTokens: number;
  /** Output tokens, thinking included. */
  outputTokens: number;
  /** The part of the output spent thinking, when the API breaks it out (otherwise 0). */
  reasoningTokens: number;
  costUsd: number;
}

function runCost(model: string, t: TokenCounts, prices: Record<string, ModelPrice>) {
  const uncached = t.input_tokens ?? 0;
  const written = t.cache_creation_input_tokens ?? 0;
  const read = t.cache_read_input_tokens ?? 0;
  const output = t.output_tokens ?? 0;
  const prompt = uncached + written + read;
  const price = priceFor(model, prices);
  const r: Rates = price.longPrompt && prompt > price.longPrompt.overTokens ? price.longPrompt : price;
  return { prompt, read, output, usd: (uncached * r.input + written * r.cacheWrite + read * r.cacheRead + output * r.output) / 1e6 };
}

/**
 * Refusal categories that are billed even when the model declines before writing anything. A request declined
 * before any output in another category (or with none) is not billed; one declined part-way through always is.
 * Source: "How refusals are billed", https://platform.claude.com/docs/en/build-with-claude/refusals-and-fallback
 * (read 2026-11-16).
 */
export const BILLED_REFUSALS = ["bio", "frontier_llm", "reasoning_extraction"];

/**
 * Tokens and estimated cost of one response. `model` is the model that was asked for. When the response lists
 * its model runs (`usage.iterations`), each run is costed at the rates of the model that ran it and the runs are
 * added up; otherwise the top-level counts are costed at `model`'s rates.
 *
 * `declined` holds the refusal category (or null) of each run that declined, in order: the runs before a
 * fallback model took over and, when the response itself is a refusal, the last run too. A declined run that
 * wrote nothing costs nothing unless its category is billed; its tokens are still counted.
 */
export function costOf(model: string, usage: ApiUsage | null | undefined, prices: Record<string, ModelPrice> = MODEL_PRICES, declined: (string | null)[] = []): CallCost {
  if (!usage) return { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0, costUsd: 0 };
  const runs = (usage.iterations ?? []).filter((i) => i.type === "message" || i.type === "fallback_message");
  const parts = (runs.length ? runs.map((i) => runCost(i.model || model, i, prices)) : [runCost(model, usage, prices)]).map((p, i) =>
    i < declined.length && p.output === 0 && !BILLED_REFUSALS.includes(declined[i] ?? "") ? { ...p, usd: 0 } : p,
  );
  const sum = (k: "prompt" | "read" | "output" | "usd") => parts.reduce((a, p) => a + p[k], 0);
  return {
    inputTokens: sum("prompt"),
    cachedTokens: sum("read"),
    outputTokens: sum("output"),
    reasoningTokens: usage.output_tokens_details?.thinking_tokens ?? 0,
    costUsd: sum("usd"),
  };
}
