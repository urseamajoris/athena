import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { config, countPaid, type AiProvider, type ModelRole } from "../config";
import { estimateProviderCost } from "../shared/ai-providers";
import { DATA_RULES, fill, loadPrompt } from "./prompts";
import { toAnthropicSchema, toGeminiSchema, toXaiSchema, zodErrorText } from "./schema";
import { limiter, newId, errMsg } from "../util";
import { resolvedModel } from "./models";
import { activeProvider, aiEnabled, budgetLimit, effectiveModels, effectiveProviderKey } from "../settings";
import { fingerprint, redactSecrets } from "../auth/secrets";
import { AiUnavailableError, AiValidationError, BudgetError, aiRefusal } from "./errors";
export { repairId } from "../grounding";
export { AiPausedError, AiUnavailableError, AiValidationError, BudgetError, isAiStop } from "./errors";

const g = globalThis as unknown as { __xai?: { client: OpenAI; fp: string }; __aiLimit?: ReturnType<typeof limiter>; __noEffort?: Set<string> };
/** The OpenAI-compatible SDK client for xAI; rebuilt when the key changes. */
function xaiClient(key: string): OpenAI {
  const fp = fingerprint(key);
  if (!g.__xai || g.__xai.fp !== fp) {
    g.__xai = { client: new OpenAI({ apiKey: key, baseURL: config.xaiBaseUrl, maxRetries: 5, timeout: 600_000 }), fp };
  }
  return g.__xai.client;
}

/** Refuses the call (and logs the refusal) when AI is switched off or no key is configured for the active provider. No model call, no cost. */
async function assertAiOn(provider: AiProvider, log: (row: Partial<typeof schema.aiCalls.$inferInsert>) => Promise<unknown>) {
  const [enabled, { key }] = await Promise.all([aiEnabled(), effectiveProviderKey(provider)]);
  const refused = aiRefusal({ enabled, key, provider });
  if (!refused) return key;
  await log(refused.row);
  throw refused.error;
}
export const aiLimit = (g.__aiLimit ??= limiter(config.aiConcurrency));
const noEffort = (g.__noEffort ??= new Set());

export async function totalSpend(): Promise<number> {
  const r = (await db.select({ s: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}),0)` }).from(schema.aiCalls).get());
  return r?.s ?? 0;
}

function estimateCost(provider: AiProvider, model: string, input: number, cached: number, output: number) {
  const p = config.pricing[model];
  if (p) return ((Math.max(0, input - cached)) * p.input + cached * p.cachedInput + output * p.output) / 1e6;
  return estimateProviderCost(provider, model, input, cached, output);
}

interface RawTurn {
  raw: string;
  input: number;
  cached: number;
  output: number;
  reasoning: number;
  apiCost: number | null;
}

const RETRY_STATUSES = new Set([429, 500, 502, 503, 504, 529]);

async function fetchWithRetry(url: string, init: RequestInit, maxRetries = 4): Promise<Response> {
  let lastRes: Response | null = null;
  for (let i = 0; i <= maxRetries; i++) {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(600_000) });
    if (res.ok || !RETRY_STATUSES.has(res.status) || i === maxRetries) return res;
    lastRes = res;
    const ra = Number(res.headers.get("retry-after"));
    const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : Math.min(1000 * 2 ** i + Math.random() * 500, 20_000);
    await new Promise((r) => setTimeout(r, wait));
  }
  return lastRes!;
}

/** Call Anthropic Messages API using a forced tool call to enforce the exact JSON schema. */
async function callAnthropic(params: {
  key: string;
  model: string;
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  toolName: string;
  schema: Record<string, unknown>;
  role: ModelRole;
}): Promise<RawTurn> {
  const res = await fetchWithRetry(`${config.anthropicBaseUrl}/messages`, {
    method: "POST",
    headers: {
      "x-api-key": params.key,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: params.model,
      max_tokens: params.role === "reasoning" ? 8192 : 4096,
      system: params.system,
      messages: params.history.map((m) => ({ role: m.role, content: m.content })),
      tools: [
        {
          name: params.toolName,
          description: "Submit the structured JSON response matching the required schema.",
          input_schema: params.schema,
        },
      ],
      tool_choice: { type: "tool", name: params.toolName },
    }),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Anthropic API error (HTTP ${res.status}): ${errText.slice(0, 400)}`);
  }
  const j = (await res.json()) as {
    content?: { type: string; input?: unknown; text?: string }[];
    usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number };
  };
  const toolBlock = j.content?.find((b) => b.type === "tool_use");
  const textBlock = j.content?.find((b) => b.type === "text");
  const raw = toolBlock?.input !== undefined ? JSON.stringify(toolBlock.input) : (textBlock?.text ?? "");
  return {
    raw,
    input: j.usage?.input_tokens ?? 0,
    cached: j.usage?.cache_read_input_tokens ?? 0,
    output: j.usage?.output_tokens ?? 0,
    reasoning: 0,
    apiCost: null,
  };
}

/** Call Google Gemini generateContent API with structured JSON output. */
async function callGemini(params: {
  key: string;
  model: string;
  system: string;
  history: { role: "user" | "assistant"; content: string }[];
  schema: Record<string, unknown>;
}): Promise<RawTurn> {
  const url = `${config.geminiBaseUrl}/models/${encodeURIComponent(params.model)}:generateContent`;
  const contents = params.history.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: m.content }],
  }));
  const send = (useSchema: boolean) =>
    fetchWithRetry(url, {
      method: "POST",
      headers: {
        "x-goog-api-key": params.key,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [
            {
              text: useSchema
                ? params.system
                : `${params.system}\n\nReturn ONLY valid JSON matching this JSON Schema:\n${JSON.stringify(params.schema)}`,
            },
          ],
        },
        contents,
        generationConfig: useSchema
          ? { responseMimeType: "application/json", responseJsonSchema: params.schema }
          : { responseMimeType: "application/json" },
      }),
    });

  let res = await send(true);
  if (res.status === 400) {
    const errText = await res.text().catch(() => "");
    if (/responseJsonSchema|response_json_schema|schema/i.test(errText)) {
      res = await send(false);
    } else {
      throw new Error(`Gemini API error (HTTP 400): ${errText.slice(0, 400)}`);
    }
  }
  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    throw new Error(`Gemini API error (HTTP ${res.status}): ${errText.slice(0, 400)}`);
  }
  const j = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number; thoughtsTokenCount?: number };
  };
  const raw = j.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const u = j.usageMetadata;
  const reasoning = u?.thoughtsTokenCount ?? 0;
  return {
    raw,
    input: u?.promptTokenCount ?? 0,
    cached: u?.cachedContentTokenCount ?? 0,
    output: (u?.candidatesTokenCount ?? 0) + reasoning,
    reasoning,
    apiCost: null,
  };
}

export interface CallOpts<T> {
  prompt: string; // prompt file name
  role: ModelRole;
  vars: Record<string, string>;
  schema: z.ZodType<T>;
  projectId?: string | null;
  stage?: number | null;
  /** Extra semantic validation (e.g. grounded-ID checks). Return an error message to trigger the retry. */
  check?: (out: T) => string | null;
  /** Deterministic clean-up applied after schema validation and before `check` (e.g. repairing ID formatting). */
  normalize?: (out: T) => T;
}

export interface CallResult<T> {
  data: T;
  model: string;
  promptVersion: string;
}

/**
 * Structured call across Anthropic, Gemini, or xAI + zod validation. On validation failure,
 * retries once with the error message; then throws AiValidationError (never returns unvalidated output).
 */
export async function structuredCall<T>(opts: CallOpts<T>): Promise<CallResult<T>> {
  const prompt = loadPrompt(opts.prompt);
  const provider = await activeProvider();
  const configuredModels = await effectiveModels(provider);
  const model = provider === "xai" ? (resolvedModel(opts.role) || configuredModels[opts.role]) : configuredModels[opts.role];
  const system = `${fill(prompt.system, opts.vars)}\n\n${DATA_RULES}`;
  const user = fill(prompt.user, opts.vars);
  const toolName = prompt.name.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 60) || "structured_output";
  const xaiSchema = toXaiSchema(opts.schema);

  const log = async (row: Partial<typeof schema.aiCalls.$inferInsert>) =>
    (await db.insert(schema.aiCalls).values({
      id: newId("ai"),
      projectId: opts.projectId ?? null,
      stage: opts.stage ?? null,
      promptName: prompt.name,
      promptVersion: prompt.version,
      model,
      status: "ok",
      ...row,
    }).run());

  const validate = (raw: string): { ok: true; data: T } | { ok: false; error: string } => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return { ok: false, error: "Response was not valid JSON." };
    }
    const r = opts.schema.safeParse(parsed);
    if (!r.success) return { ok: false, error: zodErrorText(r.error) };
    const data = opts.normalize ? opts.normalize(r.data) : r.data;
    const extra = opts.check?.(data);
    if (extra) return { ok: false, error: extra };
    return { ok: true, data };
  };

  await assertAiOn(provider, log);

  const history: { role: "user" | "assistant"; content: string }[] = [{ role: "user", content: user }];

  let lastError = "";
  let lastRaw = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const key = await assertAiOn(provider, log);
    if (!key) throw new AiUnavailableError(provider);
    const spent = (await totalSpend());
    const limit = await budgetLimit();
    if (spent >= limit) {
      (await log({ status: "refused", error: `budget reached ($${spent.toFixed(2)} of $${limit})` }));
      throw new BudgetError(`AI budget reached ($${spent.toFixed(2)} of $${limit.toFixed(2)}). Your work is saved; the administrator can raise the limit.`);
    }
    countPaid();
    const started = Date.now();
    const effort = opts.role === "reasoning" ? config.reasoningEffort : config.fastReasoningEffort;
    const useEffort = provider === "xai" && !!effort && !noEffort.has(model);
    try {
      let turn: RawTurn;
      if (provider === "anthropic") {
        const schemaObj = toAnthropicSchema(opts.schema);
        turn = await aiLimit(() => callAnthropic({ key, model, system, history, toolName, schema: schemaObj, role: opts.role }));
      } else if (provider === "gemini") {
        const schemaObj = toGeminiSchema(opts.schema);
        turn = await aiLimit(() => callGemini({ key, model, system, history, schema: schemaObj }));
      } else {
        const xai = xaiClient(key);
        const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
          { role: "system", content: system },
          ...history.map((m) => ({ role: m.role, content: m.content })),
        ];
        const res = await aiLimit(() =>
          xai.chat.completions.create({
            model,
            messages,
            response_format: { type: "json_schema", json_schema: { name: toolName, strict: true, schema: xaiSchema } },
            ...(useEffort ? { reasoning_effort: effort as "low" | "medium" | "high" } : {}),
          }),
        );
        const u = res.usage as (OpenAI.CompletionUsage & { cost_in_usd_ticks?: number }) | undefined;
        const reasoning = u?.completion_tokens_details?.reasoning_tokens ?? 0;
        turn = {
          raw: res.choices[0]?.message?.content ?? "",
          input: u?.prompt_tokens ?? 0,
          cached: u?.prompt_tokens_details?.cached_tokens ?? 0,
          output: (u?.completion_tokens ?? 0) + reasoning,
          reasoning,
          apiCost: typeof u?.cost_in_usd_ticks === "number" ? u.cost_in_usd_ticks / 1e10 : null,
        };
      }
      lastRaw = turn.raw;
      const v = validate(turn.raw);
      (await log({
        status: v.ok ? "ok" : "invalid",
        error: v.ok ? null : v.error,
        attempt,
        inputTokens: turn.input,
        cachedTokens: turn.cached,
        outputTokens: turn.output,
        reasoningTokens: turn.reasoning,
        costUsd: turn.apiCost ?? estimateCost(provider, model, turn.input, turn.cached, turn.output),
        costSource: turn.apiCost !== null ? "api" : "estimate",
        durationMs: Date.now() - started,
      }));
      if (v.ok) return { data: v.data, model, promptVersion: prompt.version };
      lastError = v.error;
      history.push({ role: "assistant", content: turn.raw });
      history.push({ role: "user", content: `Your previous response failed validation: ${v.error}\nReturn a corrected JSON response that fixes these problems. Use only the provided records and IDs.` });
    } catch (e) {
      const msg = redactSecrets(errMsg(e), [key, config.xaiApiKey, config.anthropicApiKey, config.geminiApiKey]);
      if (useEffort && /reasoningEffort|reasoning_effort/i.test(msg)) {
        noEffort.add(model);
        attempt--; // not a validation attempt; retry without the parameter
        continue;
      }
      (await log({ status: "error", error: msg.slice(0, 500), attempt, durationMs: Date.now() - started }));
      throw new Error(msg); // never rethrow the SDK error itself: it can carry request headers
    }
  }
  throw new AiValidationError(`The AI response did not pass validation after one retry: ${lastError}`, lastRaw);
}

/** Helper for grounded-ID checks. */
export function unknownIds(found: string[], allowed: Iterable<string>): string[] {
  const set = new Set(allowed);
  return [...new Set(found.filter((x) => !set.has(x)))];
}
