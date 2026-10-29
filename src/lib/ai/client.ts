import "server-only";
import OpenAI from "openai";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { config, countPaid, type ModelRole } from "../config";
import { DATA_RULES, fill, loadPrompt } from "./prompts";
import { toXaiSchema, zodErrorText } from "./schema";
import { limiter, newId, errMsg } from "../util";
import { resolvedModel } from "./models";
import { aiEnabled, budgetLimit, effectiveXaiKey } from "../settings";
import { fingerprint, redactSecrets } from "../auth/secrets";
import { AiUnavailableError, AiValidationError, BudgetError, aiRefusal } from "./errors";
export { repairId } from "../grounding";
export { AiPausedError, AiUnavailableError, AiValidationError, BudgetError, isAiStop } from "./errors";

const g = globalThis as unknown as { __xai?: { client: OpenAI; fp: string }; __aiLimit?: ReturnType<typeof limiter>; __noEffort?: Set<string> };
/** The SDK client for the key in force (admin-set or environment); rebuilt when the key changes. */
async function client(): Promise<{ client: OpenAI; key: string }> {
  const { key } = await effectiveXaiKey();
  if (!key) throw new AiUnavailableError();
  const fp = fingerprint(key);
  if (!g.__xai || g.__xai.fp !== fp) {
    // The SDK retries 429/5xx with exponential backoff; we raise the retry count for xAI rate limits.
    g.__xai = { client: new OpenAI({ apiKey: key, baseURL: config.xaiBaseUrl, maxRetries: 5, timeout: 600_000 }), fp };
  }
  return { client: g.__xai.client, key };
}

/** Refuses the call (and logs the refusal) when AI is switched off or no key is configured. No model call, no cost. */
async function assertAiOn(log: (row: Partial<typeof schema.aiCalls.$inferInsert>) => Promise<unknown>) {
  const [enabled, { key }] = await Promise.all([aiEnabled(), effectiveXaiKey()]);
  const refused = aiRefusal({ enabled, key });
  if (!refused) return;
  await log(refused.row);
  throw refused.error;
}
export const aiLimit = (g.__aiLimit ??= limiter(config.aiConcurrency));
const noEffort = (g.__noEffort ??= new Set());

export async function totalSpend(): Promise<number> {
  const r = (await db.select({ s: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}),0)` }).from(schema.aiCalls).get());
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

  await assertAiOn(log);

  const messages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  let lastError = "";
  let lastRaw = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    if (attempt > 1) await assertAiOn(log); // switched off (or the key removed) between the attempt and its retry
    const spent = (await totalSpend());
    const limit = await budgetLimit();
    if (spent >= limit) {
      (await log({ status: "refused", error: `budget reached ($${spent.toFixed(2)} of $${limit})` }));
      throw new BudgetError(`AI budget reached ($${spent.toFixed(2)} of $${limit.toFixed(2)}). Your work is saved; the administrator can raise the limit.`);
    }
    const { client: xai, key } = await client();
    countPaid();
    const started = Date.now();
    const useEffort = (opts.role === "fast" || opts.role === "summary") && config.fastReasoningEffort && !noEffort.has(model);
    try {
      const res = await aiLimit(() =>
        xai.chat.completions.create({
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
      (await log({
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
              }));
      if (v.ok) return { data: v.data, model, promptVersion: prompt.version };
      lastError = v.error;
      messages.push({ role: "assistant", content: raw });
      messages.push({ role: "user", content: `Your previous response failed validation: ${v.error}\nReturn a corrected JSON response that fixes these problems. Use only the provided records and IDs.` });
    } catch (e) {
      const msg = redactSecrets(errMsg(e), [key, config.xaiApiKey]);
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
