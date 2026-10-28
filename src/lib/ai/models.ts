import "server-only";
import { config, type ModelRole } from "../config";

/**
 * Model IDs come from env. At startup we call GET /v1/models to confirm each one exists; if a slug has been
 * retired we pick the closest current Grok text model (longest shared prefix, same reasoning/non-reasoning
 * suffix where possible) and report it in the UI and server log.
 */
interface Resolution {
  role: ModelRole;
  configured: string;
  resolved: string;
  status: "ok" | "substituted" | "unchecked" | "mock";
  note: string;
}

const g = globalThis as unknown as { __models?: Record<ModelRole, Resolution>; __modelsChecked?: Promise<void> };

function initial(): Record<ModelRole, Resolution> {
  const out = {} as Record<ModelRole, Resolution>;
  for (const role of Object.keys(config.models) as ModelRole[]) {
    const id = config.models[role];
    out[role] = { role, configured: id, resolved: id, status: config.mockAi ? "mock" : "unchecked", note: config.mockAi ? "MOCK_MODE: canned responses" : "not yet checked" };
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

export async function checkModels(): Promise<void> {
  if (config.mockAi || !config.xaiApiKey) return;
  if (g.__modelsChecked) return g.__modelsChecked;
  g.__modelsChecked = (async () => {
    const res = modelResolutions();
    try {
      const r = await fetch(`${config.xaiBaseUrl}/models`, { headers: { Authorization: `Bearer ${config.xaiApiKey}` }, signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { data: { id: string }[] };
      const ids = j.data.map((m) => m.id);
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
      for (const role of Object.keys(res) as ModelRole[]) res[role].note = `model check failed: ${(e as Error).message}`;
      console.warn("[athena] could not verify xAI models:", (e as Error).message);
    }
  })();
  return g.__modelsChecked;
}
