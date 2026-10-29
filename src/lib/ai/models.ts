import "server-only";
import { config, countPaid, type ModelRole } from "../config";
import { effectiveXaiKey } from "../settings";
import { redactSecrets } from "../auth/secrets";

/**
 * Model IDs come from env. At startup we call GET /v1/models to confirm each one exists; if a slug has been
 * retired we pick the closest current Grok text model (longest shared prefix, same reasoning/non-reasoning
 * suffix where possible) and report it in the UI and server log.
 */
interface Resolution {
  role: ModelRole;
  configured: string;
  resolved: string;
  status: "ok" | "substituted" | "unchecked";
  note: string;
}

const g = globalThis as unknown as { __models?: Record<ModelRole, Resolution>; __modelsChecked?: Promise<void>; __modelsKey?: string };

function initial(): Record<ModelRole, Resolution> {
  const out = {} as Record<ModelRole, Resolution>;
  for (const role of Object.keys(config.models) as ModelRole[]) {
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

function closest(target: string, available: string[]): string | null {
  const text = available.filter((m) => m.startsWith("grok") && !/imagine|image|video|vision|tts|embed/i.test(m));
  if (!text.length) return null;
  const wantsReasoning = /reasoning/.test(target) && !/non-reasoning/.test(target);
  const score = (m: string) => {
    let p = 0;
    while (p < m.length && p < target.length && m[p] === target[p]) p++;
    const sameKind = wantsReasoning ? /reasoning/.test(m) && !/non-reasoning/.test(m) : !/(^|-)reasoning/.test(m) || /non-reasoning/.test(m);
    return p + (sameKind ? 5 : 0) - (/multi-agent|build/.test(m) ? 10 : 0);
  };
  return [...text].sort((a, b) => score(b) - score(a))[0];
}

/** GET /v1/models with this key (free: no tokens). The model IDs it lists, or an error with the key removed. */
async function listModels(key: string): Promise<string[]> {
  const r = await fetch(`${config.xaiBaseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? `xAI rejected the key (HTTP ${r.status})` : `HTTP ${r.status}`);
  const j = (await r.json()) as { data: { id: string }[] };
  return j.data.map((m) => m.id);
}

/** The dashboard's "Test key": the same /v1/models check the server runs at start, for the key in force. */
export async function testKey(): Promise<{ ok: boolean; message: string; source: "admin" | "environment" | "none" }> {
  const { key, source, error } = await effectiveXaiKey();
  if (!key) return { ok: false, message: "No key is configured.", source };
  try {
    countPaid("keyTest");
    const ids = await listModels(key);
    const missing = Object.values(config.models).filter((m) => !ids.includes(m));
    g.__modelsChecked = undefined; // re-resolve models with this key on the next status read
    return { ok: true, message: `Key accepted. ${ids.length} models listed${missing.length ? `; not listed: ${missing.join(", ")}` : "; all configured models are available"}.${error ? ` ${error}` : ""}`, source };
  } catch (e) {
    return { ok: false, message: redactSecrets((e as Error).message, [key, config.xaiApiKey]), source };
  }
}

/** Confirms the model IDs whenever a key is configured; with no key every role stays unchecked and says why. */
export async function checkModels(): Promise<void> {
  const { key } = await effectiveXaiKey();
  if (!key) {
    const res = modelResolutions();
    for (const role of Object.keys(res) as ModelRole[]) res[role] = { ...res[role], resolved: res[role].configured, status: "unchecked", note: "no xAI key configured" };
    g.__modelsChecked = undefined;
    g.__modelsKey = undefined;
    return;
  }
  if (g.__modelsChecked && g.__modelsKey === key) return g.__modelsChecked;
  g.__modelsKey = key;
  g.__modelsChecked = (async () => {
    const res = modelResolutions();
    try {
      const ids = await listModels(key);
      for (const role of Object.keys(res) as ModelRole[]) {
        const want = res[role].configured;
        if (ids.includes(want)) {
          res[role] = { ...res[role], resolved: want, status: "ok", note: "confirmed via /v1/models" };
        } else {
          const alt = closest(want, ids);
          res[role] = alt
            ? { ...res[role], resolved: alt, status: "substituted", note: `${want} not listed by xAI; using closest current model ${alt}` }
            : { ...res[role], status: "unchecked", note: `${want} not listed and no Grok text model found` };
          console.warn(`[athena] model ${role}: ${res[role].note}`);
        }
      }
    } catch (e) {
      const msg = redactSecrets((e as Error).message, [key]);
      for (const role of Object.keys(res) as ModelRole[]) res[role].note = `model check failed: ${msg}`;
      console.warn("[athena] could not verify xAI models:", msg);
    }
  })();
  return g.__modelsChecked;
}
