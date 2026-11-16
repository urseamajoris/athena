import "server-only";
import { config, countPaid, effortFor, type ModelRole } from "../config";
import { effectiveApiKey } from "../settings";
import { redactSecrets } from "../auth/secrets";
import { errMsg } from "../util";
import { dropEffortFor, listModels, type ListedModel } from "./request";
import { resolveModel, type ModelStatus } from "./resolve";

/**
 * Model IDs come from the environment, one per role. When a key is configured, the server asks the API which
 * models that key can use (the models list: free, no tokens) and confirms each ID. An ID that is not listed is
 * replaced by the newest listed model of the same family (opus, sonnet, haiku, fable), and the status page, the
 * admin dashboard and the server log say so. With no key every role stays "unchecked".
 */
interface Resolution {
  role: ModelRole;
  configured: string;
  resolved: string;
  status: ModelStatus;
  note: string;
}

const g = globalThis as unknown as { __models?: Record<ModelRole, Resolution>; __modelsChecked?: Promise<void>; __modelsKey?: string };
const ROLES = Object.keys(config.models) as ModelRole[];

function initial(): Record<ModelRole, Resolution> {
  const out = {} as Record<ModelRole, Resolution>;
  for (const role of ROLES) {
    const id = config.models[role];
    out[role] = { role, configured: id, resolved: id, status: "unchecked", note: "not yet checked" };
  }
  return out;
}

export function modelResolutions() {
  return (g.__models ??= initial());
}

export function resolvedModel(role: ModelRole): string {
  return modelResolutions()[role].resolved;
}

/** The dashboard's "Test key": the same models-list check the server runs at start, for the key in force. */
export async function testKey(): Promise<{ ok: boolean; message: string; source: "admin" | "environment" | "none" }> {
  const { key, source, error } = await effectiveApiKey();
  if (!key) return { ok: false, message: "No key is configured.", source };
  try {
    countPaid();
    const listed = await listModels(key, config.anthropicBaseUrl);
    const missing = [...new Set(Object.values(config.models))].filter((id) => resolveModel(id, listed).status !== "ok");
    g.__modelsChecked = undefined; // re-resolve models with this key on the next status read
    return { ok: true, message: `Key accepted. ${listed.length} models listed${missing.length ? `; not listed: ${missing.join(", ")}` : "; all configured models are available"}.${error ? ` ${error}` : ""}`, source };
  } catch (e) {
    return { ok: false, message: redactSecrets(errMsg(e), [key, config.anthropicApiKey]), source };
  }
}

/** Sets each role's model from the list, and notes an effort level the model does not take. */
function apply(listed: ListedModel[]) {
  const res = modelResolutions();
  for (const role of ROLES) {
    const r = resolveModel(res[role].configured, listed);
    let note = r.note;
    const effort = effortFor(role);
    const efforts = listed.find((m) => m.id === r.resolved)?.efforts;
    if (effort && efforts && !efforts.includes(effort)) {
      dropEffortFor(r.resolved);
      note += `; it does not take effort "${effort}", so its own default is used`;
    }
    res[role] = { ...res[role], ...r, note };
    if (r.status !== "ok") console.warn(`[athena] model ${role}: ${note}`);
  }
}

/** Confirms the model IDs whenever a key is configured; with no key every role stays unchecked and says why. */
export async function checkModels(): Promise<void> {
  const { key } = await effectiveApiKey();
  if (!key) {
    const res = modelResolutions();
    for (const role of ROLES) res[role] = { ...res[role], resolved: res[role].configured, status: "unchecked", note: "no API key configured" };
    g.__modelsChecked = undefined;
    g.__modelsKey = undefined;
    return;
  }
  if (g.__modelsChecked && g.__modelsKey === key) return g.__modelsChecked;
  g.__modelsKey = key;
  g.__modelsChecked = (async () => {
    try {
      apply(await listModels(key, config.anthropicBaseUrl));
    } catch (e) {
      const msg = redactSecrets(errMsg(e), [key, config.anthropicApiKey]);
      const res = modelResolutions();
      for (const role of ROLES) res[role] = { ...res[role], resolved: res[role].configured, status: "unchecked", note: `model check failed: ${msg}` };
      console.warn("[athena] could not check the AI models:", msg);
    }
  })();
  return g.__modelsChecked;
}
