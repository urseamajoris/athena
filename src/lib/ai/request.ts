// One request to the model, and nothing else: no database, no settings, no logging. client.ts wraps it with the
// checks, the ai_calls log, credits and validation; scripts/ai-smoke.ts calls it directly.
import Anthropic from "@anthropic-ai/sdk";
import { fingerprint, redactSecrets } from "../auth/secrets";
import type { ApiUsage } from "./cost";

export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

/** `raw` as an effort level; empty means "send none" (the model's default); anything else falls back. */
export function parseEffort(raw: string | undefined, fallback: Effort): Effort | null {
  const v = raw?.trim().toLowerCase();
  if (v === undefined) return fallback;
  if (v === "") return null;
  return (EFFORTS as readonly string[]).includes(v) ? (v as Effort) : fallback;
}

/**
 * Models whose declined requests the API can re-run on another model (server-side fallbacks). Other models
 * have no such re-run, so the parameter is not sent for them.
 */
export const REFUSAL_FALLBACK_MODELS = ["claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-fable-5-2", "claude-fable-5-1", "claude-mythos-5-2", "claude-mythos-5-1"];
export const supportsRefusalFallback = (model: string) => REFUSAL_FALLBACK_MODELS.some((id) => model === id || model.startsWith(`${id}-`));
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
/** A streamed answer that has not finished after this long is abandoned, so a stalled stream cannot hang a job. */
const ANSWER_DEADLINE_MS = 30 * 60_000;

const g = globalThis as unknown as { __aiSdk?: { id: string; client: Anthropic }; __aiNoEffort?: Set<string>; __aiNoFallback?: Set<string> };
/** Models that rejected a parameter: it is left out for them from then on (until the server restarts). */
const noEffort = (g.__aiNoEffort ??= new Set());
const noFallback = (g.__aiNoFallback ??= new Set());
export const dropEffortFor = (model: string) => void noEffort.add(model);

/**
 * The SDK client for this key and base URL; rebuilt when either changes. Both are always passed in, and a
 * credential passed in code is the only one the SDK uses: it then reads neither ANTHROPIC_API_KEY,
 * ANTHROPIC_AUTH_TOKEN, ANTHROPIC_BASE_URL nor a login profile. An empty key is refused here because, with no
 * key, the SDK would go looking for those.
 */
export function sdkClient(apiKey: string, baseUrl: string): Anthropic {
  if (!apiKey || !baseUrl) throw new Error("The AI client needs an API key and a base URL.");
  const id = `${fingerprint(apiKey)}@${baseUrl}`;
  if (g.__aiSdk?.id !== id) {
    // The SDK retries 429, 5xx and connection failures with backoff. The timeout is how long it waits for a
    // response to start; a streamed answer may then take longer (see ANSWER_DEADLINE_MS). logLevel is fixed so
    // that ANTHROPIC_LOG cannot switch on debug logging (which prints request bodies).
    g.__aiSdk = { id, client: new Anthropic({ apiKey, baseURL: baseUrl, maxRetries: 4, timeout: 600_000, logLevel: "warn" }) };
  }
  return g.__aiSdk.client;
}

export interface ModelRequest {
  apiKey: string;
  baseUrl: string;
  model: string;
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  /** JSON Schema the answer is constrained to (see toModelSchema). */
  schema: Record<string, unknown>;
  /** null = do not send an effort level. */
  effort: Effort | null;
  maxTokens: number;
}

export interface ModelReply {
  /** Why the model stopped: "end_turn" for a complete answer, "refusal", "max_tokens", ... */
  stopReason: string | null;
  /** For a refusal: the policy area, when the API names one. */
  refusalCategory: string | null;
  /**
   * The refusal category (or null) of each model run that declined, in order: the runs a fallback model took
   * over from and, for a refusal, the last run. Decides which runs are billed (see costOf).
   */
  declined: (string | null)[];
  /** The text of the answer (empty for a refusal before any output). */
  text: string;
  /** The model that produced the answer: the one asked for, or the one a declined request was re-run on. */
  model: string;
  usage: ApiUsage;
}

/** Everything the app reads from a response. A `fallback` block only marks where another model took over. */
function reply(m: { stop_reason: string | null; stop_details: { category: string | null } | null; content: { type: string; text?: string; trigger?: { category: string | null } }[]; model: string; usage: ApiUsage }): ModelReply {
  const refusalCategory = m.stop_reason === "refusal" ? (m.stop_details?.category ?? null) : null;
  return {
    stopReason: m.stop_reason,
    refusalCategory,
    declined: [...m.content.filter((b) => b.type === "fallback").map((b) => b.trigger?.category ?? null), ...(m.stop_reason === "refusal" ? [refusalCategory] : [])],
    text: m.content.map((b) => (b.type === "text" ? (b.text ?? "") : "")).join(""),
    model: m.model,
    usage: m.usage,
  };
}

async function stream(req: ModelRequest, useEffort: boolean, useFallback: boolean): Promise<ModelReply> {
  const client = sdkClient(req.apiKey, req.baseUrl);
  const body = {
    model: req.model,
    max_tokens: req.maxTokens,
    // The system text is the same for every call of a job, so it is marked cacheable: later calls read it from
    // the prompt cache at a fraction of the price. A prefix too short to cache is simply not cached.
    system: [{ type: "text" as const, text: req.system, cache_control: { type: "ephemeral" as const } }],
    messages: req.messages,
    // No `thinking` setting is sent: current models decide how much to think, steered by the effort level.
    output_config: { ...(useEffort && req.effort ? { effort: req.effort } : {}), format: { type: "json_schema" as const, schema: req.schema } },
  };
  // Streamed, so a long answer cannot hit an HTTP timeout; finalMessage() assembles the complete message.
  const options = { signal: AbortSignal.timeout(ANSWER_DEADLINE_MS) };
  if (useFallback) return reply(await client.beta.messages.stream({ ...body, betas: [FALLBACK_BETA], fallbacks: "default" }, options).finalMessage());
  return reply(await client.messages.stream(body, options).finalMessage());
}

/**
 * Sends one structured request and returns the model's reply. Read `stopReason` before `text`.
 *
 * A request the model declines is re-run by the API on the model it recommends for that case (models that
 * support this only). If a model rejects the effort level, or the API rejects the re-run option, that is
 * remembered for the model and the request is sent again without it.
 *
 * Throws a plain Error with a short message: never the SDK's error object, which carries the request and
 * response headers.
 */
export async function sendStructured(req: ModelRequest): Promise<ModelReply> {
  for (;;) {
    const useEffort = !!req.effort && !noEffort.has(req.model);
    const useFallback = supportsRefusalFallback(req.model) && !noFallback.has(req.model);
    try {
      return await stream(req, useEffort, useFallback);
    } catch (e) {
      if (e instanceof Anthropic.BadRequestError) {
        const about = e.apiMessage ?? e.message;
        if (useFallback && /fallback|anthropic-beta/i.test(about)) {
          noFallback.add(req.model);
          continue;
        }
        if (useEffort && /effort/i.test(about)) {
          noEffort.add(req.model);
          continue;
        }
      }
      throw new Error(explainSdkError(e, [req.apiKey]));
    }
  }
}

export interface ListedModel {
  id: string;
  /** The model line as the API states it (opus, sonnet, haiku, fable, mythos), or null. */
  line: string | null;
  createdAt: string;
  retired: boolean;
  /** Effort levels the model accepts; null when the API does not say. */
  efforts: Effort[] | null;
}

/** The models this key can use (GET /v1/models; free, no tokens). Throws a plain Error like sendStructured. */
export async function listModels(apiKey: string, baseUrl: string): Promise<ListedModel[]> {
  try {
    const out: ListedModel[] = [];
    for await (const m of sdkClient(apiKey, baseUrl).models.list({ limit: 1000 }, { timeout: 20_000, maxRetries: 1 })) {
      const e = m.capabilities?.effort;
      out.push({
        id: m.id,
        line: m.line ?? null,
        createdAt: m.created_at,
        retired: m.lifecycle === "retired",
        efforts: e ? (e.supported ? EFFORTS.filter((level) => e[level]?.supported) : []) : null,
      });
    }
    return out;
  } catch (e) {
    throw new Error(explainSdkError(e, [apiKey]));
  }
}

const detail = (e: InstanceType<typeof Anthropic.APIError>, secrets: (string | null | undefined)[]) => {
  const text = redactSecrets((e.apiMessage ?? "").replace(/\s+/g, " ").trim(), secrets).slice(0, 300);
  return text ? ` Details: ${text}` : "";
};

/**
 * A short, plain message for an error thrown by the SDK, most specific class first. It is built from the
 * error's class, status and the API's own explanation only (never its headers), with anything key-shaped and
 * the given secrets removed.
 */
export function explainSdkError(e: unknown, secrets: (string | null | undefined)[] = []): string {
  if (e instanceof Anthropic.AuthenticationError) return "The AI service did not accept the API key: it is wrong, revoked or expired. An administrator can replace it in the dashboard.";
  if (e instanceof Anthropic.PermissionDeniedError) return `The API key is not allowed to do this. An administrator can check the key and the model settings.${detail(e, secrets)}`;
  if (e instanceof Anthropic.NotFoundError) return `The AI model was not found, or this API key cannot use it. An administrator can check the model settings.${detail(e, secrets)}`;
  if (e instanceof Anthropic.RateLimitError) return "The AI service is receiving too many requests right now. Wait a minute, then try again.";
  if (e instanceof Anthropic.ContentTooLargeError) return "The text is too long for the AI to read in one go.";
  if (e instanceof Anthropic.BadRequestError) return `The AI service did not accept the request.${detail(e, secrets)}`;
  if (e instanceof Anthropic.APIUserAbortError) return "The AI took too long to finish its answer, so the request was stopped. Try again.";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "The AI service took too long to answer. Try again in a moment.";
  if (e instanceof Anthropic.APIConnectionError) return "Could not reach the AI service. Check the server's network connection, then try again.";
  if (e instanceof Anthropic.InternalServerError) return "The AI service is busy or having problems right now. Try again in a few minutes.";
  if (e instanceof Anthropic.APIError) {
    if (e.status === 402) return "The AI service account has a billing problem. An administrator needs to check it.";
    return `The AI service returned an error${e.status ? ` (HTTP ${e.status})` : ""}.${detail(e, secrets)}`;
  }
  if (e instanceof Anthropic.AnthropicError) return redactSecrets(`The AI service did not return a complete answer. Try again. Details: ${e.message.replace(/\s+/g, " ").slice(0, 300)}`, secrets);
  return redactSecrets(e instanceof Error ? e.message : String(e), secrets);
}
