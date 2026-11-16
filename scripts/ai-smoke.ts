// A one-request check of the AI set-up, to run by hand with a real key. It spends a fraction of a cent.
//
//   ANTHROPIC_API_KEY=sk-ant-... npx tsx --conditions=react-server scripts/ai-smoke.ts
//   ANTHROPIC_API_KEY=sk-ant-... npx tsx --conditions=react-server scripts/ai-smoke.ts reasoning
//
// (--conditions=react-server lets the server-only modules load outside Next.js. The optional word is the model
// role to try: fast (the default), summary or reasoning.)
//
// What it does, with the same code the server uses and no database:
//   1. lists the models the key can use and prints which model each role resolves to;
//   2. sends ONE small structured request for the chosen role, exactly as structuredCall sends its requests
//      (streamed, schema-constrained, effort level, cacheable system block, refusal fallback);
//   3. prints the validated answer, the token usage and the cost worked out from it.
// With no key it stops before sending anything. It reads ANTHROPIC_API_KEY, the ANTHROPIC_MODEL_* and
// AI_EFFORT_* settings and ATHENA_ANTHROPIC_BASE_URL from the environment (not from .env, and never a key set in
// the admin dashboard).
import { z } from "zod";
import { config, effortFor, type ModelRole } from "../src/lib/config";
import { listModels, sendStructured, supportsRefusalFallback, type ListedModel } from "../src/lib/ai/request";
import { resolveModel } from "../src/lib/ai/resolve";
import { toModelSchema, zodErrorText } from "../src/lib/ai/schema";
import { costOf } from "../src/lib/ai/cost";
import { DECLINED_MESSAGE, aiRefusal } from "../src/lib/ai/errors";

const Answer = z.object({
  greeting: z.string().trim().min(1).max(80),
  sum: z.number().int(),
  words: z.array(z.string().trim().min(1).max(20)).min(1).max(5),
});

const ROLES = Object.keys(config.models) as ModelRole[];

async function main(): Promise<number> {
  const role = (process.argv[2] ?? "fast") as ModelRole;
  if (!ROLES.includes(role)) {
    console.error(`Unknown role "${role}". Use one of: ${ROLES.join(", ")}.`);
    return 2;
  }
  const key = config.anthropicApiKey;
  console.log(`API: ${config.anthropicBaseUrl}`);
  const refused = aiRefusal({ enabled: true, key });
  if (refused) {
    console.error(`Stopped before sending anything: ${refused.error.message}`);
    console.error("Set ANTHROPIC_API_KEY for this command to run the check.");
    return 2;
  }

  // 1. The models this key can use, and what each role resolves to.
  let listed: ListedModel[] | null = null;
  try {
    listed = await listModels(key, config.anthropicBaseUrl);
    console.log(`Models listed for this key: ${listed.length}`);
  } catch (e) {
    console.error(`Could not list the models: ${(e as Error).message}`);
  }
  const resolved = {} as Record<ModelRole, string>;
  for (const r of ROLES) {
    const res = listed ? resolveModel(config.models[r], listed) : { resolved: config.models[r], status: "unchecked", note: "the model list could not be read" };
    resolved[r] = res.resolved;
    console.log(`  ${r.padEnd(9)} ${config.models[r]} -> ${res.resolved}  [${res.status}] ${res.note}`);
  }

  // 2. One small request, through the same function structuredCall uses.
  const model = resolved[role];
  const effort = effortFor(role);
  console.log(`\nSending one request: role ${role}, model ${model}, effort ${effort ?? "(model default)"}, refusal fallback ${supportsRefusalFallback(model) ? "on" : "not available for this model"}.`);
  const started = Date.now();
  let reply;
  try {
    reply = await sendStructured({
      apiKey: key,
      baseUrl: config.anthropicBaseUrl,
      model,
      system: "You are checking that a connection works. Answer exactly what is asked, as JSON that matches the provided schema.",
      messages: [{ role: "user", content: "Greet the reader in five words or fewer, give the sum of 19 and 23, and list the words of your greeting." }],
      schema: toModelSchema(Answer),
      effort,
      maxTokens: config.maxOutputTokens,
    });
  } catch (e) {
    console.error(`The request failed: ${(e as Error).message}`);
    return 1;
  }

  // 3. The answer, the usage and the cost.
  const cost = costOf(model, reply.usage, config.pricing, reply.declined);
  console.log(`Answered by ${reply.model} in ${((Date.now() - started) / 1000).toFixed(1)} s; stop reason: ${reply.stopReason}.`);
  console.log("Usage:", JSON.stringify(reply.usage));
  console.log(`Tokens: ${cost.inputTokens} prompt (${cost.cachedTokens} read from the cache), ${cost.outputTokens} output (${cost.reasoningTokens} of them thinking).`);
  console.log(`Estimated cost: $${cost.costUsd.toFixed(6)}`);
  if (reply.stopReason === "refusal") {
    console.error(`${DECLINED_MESSAGE}${reply.refusalCategory ? ` (category: ${reply.refusalCategory})` : ""}`);
    return 1;
  }
  if (reply.stopReason === "max_tokens") {
    console.error("The answer was cut off before it was finished.");
    return 1;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(reply.text);
  } catch {
    console.error(`The answer was not valid JSON: ${reply.text.slice(0, 300)}`);
    return 1;
  }
  const checked = Answer.safeParse(parsed);
  if (!checked.success) {
    console.error(`The answer did not pass validation: ${zodErrorText(checked.error)}`);
    console.error(reply.text.slice(0, 300));
    return 1;
  }
  console.log("Validated answer:", JSON.stringify(checked.data));
  if (checked.data.sum !== 42) console.warn("Note: the sum should be 42.");
  console.log("OK");
  return 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`Unexpected failure: ${e instanceof Error ? e.message : String(e)}`);
    process.exit(1);
  },
);
