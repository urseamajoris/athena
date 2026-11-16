import "server-only";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db, schema } from "../db";
import { config, countPaid, effortFor, type ModelRole } from "../config";
import { budgetReached, hasCap } from "../paid-guard";
import { DATA_RULES, fill, loadPrompt } from "./prompts";
import { toModelSchema, zodErrorText } from "./schema";
import { limiter, newId, errMsg } from "../util";
import { resolvedModel } from "./models";
import { aiEnabled, budgetLimit, effectiveApiKey } from "../settings";
import { redactSecrets } from "../auth/secrets";
import { canSpend, charge, payerFor, type Payer } from "../billing/credits";
import { costOf } from "./cost";
import { sendStructured, type ModelRequest } from "./request";
import { AiDeclinedError, AiValidationError, BudgetError, aiRefusal } from "./errors";
export { repairId } from "../grounding";
export { AiDeclinedError, AiPausedError, AiUnavailableError, AiValidationError, BudgetError, CreditsError, isAiStop } from "./errors";

const g = globalThis as unknown as { __aiLimit?: ReturnType<typeof limiter> };
export const aiLimit = (g.__aiLimit ??= limiter(config.aiConcurrency));

export async function totalSpend(): Promise<number> {
  const r = (await db.select({ s: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}),0)` }).from(schema.aiCalls).get());
  return r?.s ?? 0;
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
 * Structured call: the model's answer is constrained to the JSON Schema of `opts.schema`, then parsed and
 * validated with zod, `normalize` and `check`. On a validation failure it retries once, showing the model its
 * previous answer and the error; then it throws AiValidationError. It never returns unvalidated output.
 *
 * Before each attempt, in this order: the AI switch, the API key, the payer's credits, the server-wide budget.
 * A refused attempt is logged to ai_calls with no cost and nothing is sent. Every attempt that reaches the model
 * is logged with its tokens and cost, and its credits are taken from the account that owns the project.
 *
 * No tools are passed, so the model can only answer from the text it is given.
 */
export async function structuredCall<T>(opts: CallOpts<T>): Promise<CallResult<T>> {
  const prompt = loadPrompt(opts.prompt);
  const model = resolvedModel(opts.role);
  const system = `${fill(prompt.system, opts.vars)}\n\n${DATA_RULES}`;
  const user = fill(prompt.user, opts.vars);
  const jsonSchema = toModelSchema(opts.schema);
  // The account that pays: the project's owner. Read once here, and again before the retry.
  let payer: Payer | null = await payerFor(opts.projectId);

  const log = async (row: Partial<typeof schema.aiCalls.$inferInsert>) =>
    (await db.insert(schema.aiCalls).values({
            id: newId("ai"),
            projectId: opts.projectId ?? null,
            userId: payer?.userId ?? null,
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

  /** Refuses the attempt (and logs the refusal) when it may not run. No model call, no cost. Returns the key. */
  const gate = async (): Promise<string> => {
    const [enabled, { key }] = await Promise.all([aiEnabled(), effectiveApiKey()]);
    const refused = aiRefusal({ enabled, key, canSpend: canSpend(payer) });
    if (refused) {
      await log(refused.row);
      throw refused.error;
    }
    const limit = await budgetLimit();
    if (hasCap(limit)) {
      const spent = await totalSpend();
      if (budgetReached(spent, limit)) {
        await log({ status: "refused", error: `budget reached ($${spent.toFixed(2)} of $${limit.toFixed(2)})` });
        throw new BudgetError(`AI budget reached ($${spent.toFixed(2)} of $${limit.toFixed(2)}). Your work is saved; the administrator can raise the limit.`);
      }
    }
    return key;
  };

  const messages: ModelRequest["messages"] = [{ role: "user", content: user }];

  let lastError = "";
  let lastRaw = "";
  for (let attempt = 1; attempt <= 2; attempt++) {
    // Things can change between an attempt and its retry: AI switched off, the key removed, the credits used up.
    if (attempt > 1) payer = await payerFor(opts.projectId);
    const key = await gate();
    countPaid();
    const started = Date.now();
    let reply;
    try {
      reply = await aiLimit(() => sendStructured({ apiKey: key, baseUrl: config.anthropicBaseUrl, model, system, messages, schema: jsonSchema, effort: effortFor(opts.role), maxTokens: config.maxOutputTokens }));
    } catch (e) {
      // sendStructured throws plain messages only; the SDK's own error (which carries headers) never gets here.
      const msg = redactSecrets(errMsg(e), [key, config.anthropicApiKey]);
      await log({ status: "error", error: msg.slice(0, 500), attempt, durationMs: Date.now() - started });
      throw new Error(msg);
    }

    // The call reached the model: record what it used and take the credits, whatever the answer turns out to be.
    const cost = costOf(model, reply.usage, config.pricing, reply.declined);
    const credits = await charge(payer, cost.costUsd);
    const used = { ...cost, costSource: "estimate", credits, model: reply.model || model, attempt, durationMs: Date.now() - started };

    // Why the model stopped is read before its text: a declined request has none, a cut-off one has half.
    if (reply.stopReason === "refusal") {
      await log({ ...used, status: "error", error: `the model declined the request${reply.refusalCategory ? ` (${reply.refusalCategory})` : ""}` });
      throw new AiDeclinedError();
    }
    const raw = reply.text;
    lastRaw = raw;
    const cutOff = reply.stopReason === "max_tokens" || reply.stopReason === "model_context_window_exceeded";
    const v = cutOff ? { ok: false as const, error: "The answer was cut off before it was finished (it reached the length limit)." } : validate(raw);
    await log({ ...used, status: v.ok ? "ok" : "invalid", error: v.ok ? null : v.error });
    if (v.ok) return { data: v.data, model: used.model, promptVersion: prompt.version };
    lastError = v.error;
    if (raw.trim()) messages.push({ role: "assistant", content: raw });
    messages.push({
      role: "user",
      content: cutOff
        ? `Your previous response was cut off before it was finished, so it could not be used. Return the complete JSON response again, and keep every text field as short as the task allows so that it fits. Use only the provided records and IDs.`
        : `Your previous response failed validation: ${v.error}\nReturn a corrected JSON response that fixes these problems. Use only the provided records and IDs.`,
    });
  }
  throw new AiValidationError(`The AI response did not pass validation after one retry: ${lastError}`, lastRaw);
}

/** Helper for grounded-ID checks. */
export function unknownIds(found: string[], allowed: Iterable<string>): string[] {
  const set = new Set(allowed);
  return [...new Set(found.filter((x) => !set.has(x)))];
}
