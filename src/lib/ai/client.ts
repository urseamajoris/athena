import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { config, type ModelRole } from "../config";
import { DATA_RULES, fill, loadPrompt } from "./prompts";
import { toXaiSchema, zodErrorText } from "./schema";
import { limiter, newId, errMsg } from "../util";
import { mockRespond } from "./mock";
import { resolvedModel } from "./models";
export { repairId } from "../grounding";

export class AiValidationError extends Error {
  constructor(message: string, public raw?: string) {
    super(message);
  }
}
export class BudgetError extends Error {}

const g = globalThis as unknown as { __xai?: OpenAI; __aiLimit?: ReturnType<typeof limiter>; __noEffort?: Set<string> };
function client() {
  if (!g.__xai) {
    if (!config.xaiApiKey) throw new Error("XAI_API_KEY is not set. Add it to .env or run with MOCK_MODE=true.");
    // The SDK retries 429/5xx with exponential backoff; we raise the retry count for xAI rate limits.
    g.__xai = new OpenAI({ apiKey: config.xaiApiKey, baseURL: config.xaiBaseUrl, maxRetries: 5, timeout: 600_000 });
  }
  return g.__xai;
}
export const aiLimit = (g.__aiLimit ??= limiter(config.aiConcurrency));
const noEffort = (g.__noEffort ??= new Set());

export function totalSpend(): number {
  const r = db.select({ s: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}),0)` }).from(schema.aiCalls).get();
  return r?.s ?? 0;
}

function estimateCost(model: string, input: number, cached: number, output: number) {
  const p = config.pricing[model] ?? config.pricing.default;
  return ((input - cached) * p.input + cached * p.cachedInput + output * p.output) / 1e6;
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
  /** Data passed to the mock responder in MOCK_MODE. */
  mockInput?: unknown;
}

export interface CallResult<T> {
  data: T;
  model: string;
  promptVersion: string;
}

/**
 * Structured call: xAI response_format json_schema + zod validation. On validation failure,
 * retries once with the error message; then throws AiValidationError (never returns unvalidated output).
 * No tools are passed, so Grok's web/X search is never enabled.
 */
export async function structuredCall<T>(opts: CallOpts<T>): Promise<CallResult<T>> {
  const prompt = loadPrompt(opts.prompt);
  const model = resolvedModel(opts.role);
  const system = `${fill(prompt.system, opts.vars)}\n\n${DATA_RULES}`;
  const user = fill(prompt.user, opts.vars);
  const jsonSchema = toXaiSchema(opts.schema);

  const log = (row: Partial<typeof schema.aiCalls.$inferInsert>) =>
    db.insert(schema.aiCalls).values({
      id: newId("ai"),
      projectId: opts.projectId ?? null,
      stage: opts.stage ?? null,
      promptName: prompt.name,
      promptVersion: prompt.version,
      model,
      status: "ok",
      ...row,
    }).run();

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

  if (config.mockAi) {
    const out = await mockRespond(opts.prompt, opts.vars, opts.mockInput);
    const raw = JSON.stringify(out);
    const v = validate(raw);
    log({ status: v.ok ? "ok" : "invalid", costSource: "mock", error: v.ok ? null : v.error, inputTokens: Math.round((system.length + user.length) / 4), outputTokens: Math.round(raw.length / 4) });
    if (!v.ok) throw new AiValidationError(`Mock response failed validation: ${v.error}`, raw);
    return { data: v.data, model: `mock:${model}`, promptVersion: prompt.version };
  }

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  let lastError = "";
  let lastRaw = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    const spent = totalSpend();
    if (spent >= config.budgetUsd) {
      log({ status: "refused", error: `budget reached ($${spent.toFixed(2)} of $${config.budgetUsd})` });
      throw new BudgetError(`xAI budget cap reached ($${spent.toFixed(2)} of $${config.budgetUsd}). Raise XAI_BUDGET_USD to continue.`);
    }
    const started = Date.now();
    const useEffort = (opts.role === "fast" || opts.role === "summary") && config.fastReasoningEffort && !noEffort.has(model);
    try {
      const res = await aiLimit(() =>
        client().chat.completions.create({
          model,
          messages,
          response_format: { type: "json_schema", json_schema: { name: prompt.name.replace(/[^a-zA-Z0-9_-]/g, "_"), strict: true, schema: jsonSchema } },
          ...(useEffort ? { reasoning_effort: config.fastReasoningEffort as "low" | "medium" | "high" } : {}),
        }),
      );
      const u = res.usage as (OpenAI.CompletionUsage & { cost_in_usd_ticks?: number }) | undefined;
      const input = u?.prompt_tokens ?? 0;
      const cached = u?.prompt_tokens_details?.cached_tokens ?? 0;
      const reasoning = u?.completion_tokens_details?.reasoning_tokens ?? 0;
      const output = (u?.completion_tokens ?? 0) + reasoning;
      const apiCost = typeof u?.cost_in_usd_ticks === "number" ? u.cost_in_usd_ticks / 1e10 : null;
      const raw = res.choices[0]?.message?.content ?? "";
      lastRaw = raw;
      const v = validate(raw);
      log({
        status: v.ok ? "ok" : "invalid",
        error: v.ok ? null : v.error,
        attempt,
        inputTokens: input,
        cachedTokens: cached,
        outputTokens: output,
        reasoningTokens: reasoning,
        costUsd: apiCost ?? estimateCost(model, input, cached, output),
        costSource: apiCost !== null ? "api" : "estimate",
        durationMs: Date.now() - started,
      });
      if (v.ok) return { data: v.data, model, promptVersion: prompt.version };
      lastError = v.error;
      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: `Your previous response failed validation: ${v.error}\nReturn a corrected JSON response that fixes these problems. Use only the provided records and IDs.` });
    } catch (e) {
      const msg = errMsg(e);
      if (useEffort && /reasoningEffort|reasoning_effort/i.test(msg)) {
        noEffort.add(model);
        attempt--; // not a validation attempt; retry without the parameter
        continue;
      }
      log({ status: "error", error: msg.slice(0, 500), attempt, durationMs: Date.now() - started });
      throw e;
    }
  }
  throw new AiValidationError(`The AI response did not pass validation after one retry: ${lastError}`, lastRaw);
}

/** Helper for grounded-ID checks. */
export function unknownIds(found: string[], allowed: Iterable<string>): string[] {
  const set = new Set(allowed);
  return [...new Set(found.filter((x) => !set.has(x)))];
}
