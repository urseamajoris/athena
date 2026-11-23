import "server-only";
import { config, countPaid, type AiProvider, type ModelRole } from "../config";
import { activeProvider, effectiveModels, effectiveProviderKey } from "../settings";
import { PROVIDER_META, providerLabel } from "../shared/ai-providers";
import { redactSecrets } from "../auth/secrets";

/**
 * Model IDs come from admin settings or env. We confirm each one against the active provider's /models endpoint
 * when a key is configured; for xAI if a slug has been retired we pick the closest current Grok text model.
 */
interface Resolution {
  role: ModelRole;
  provider: AiProvider;
  configured: string;
  resolved: string;
  status: "ok" | "substituted" | "unchecked";
  note: string;
}

const g = globalThis as unknown as { __models?: Record<ModelRole, Resolution>; __modelsChecked?: Promise<void>; __modelsSig?: string };

function initial(provider: AiProvider = config.defaultProvider, models: Record<ModelRole, string> = config.providerModels[provider]): Record<ModelRole, Resolution> {
  const out = {} as Record<ModelRole, Resolution>;
  for (const role of Object.keys(models) as ModelRole[]) {
    const id = models[role];
    out[role] = { role, provider, configured: id, resolved: id, status: "unchecked", note: "not yet checked" };
  }
  return out;
}

export function modelResolutions() {
  return (g.__models ??= initial());
}

export function resetModelCache() {
  g.__modelsChecked = undefined;
  g.__modelsSig = undefined;
}

export function resolvedModel(role: ModelRole): string {
  return modelResolutions()[role].resolved;
}

function closestXai(target: string, available: string[]): string | null {
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

/** List available model IDs from the given provider's /models endpoint (free: no tokens). */
async function listProviderModels(provider: AiProvider, key: string): Promise<string[]> {
  if (provider === "anthropic") {
    const r = await fetch(`${config.anthropicBaseUrl}/models`, {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? `Anthropic rejected the key (HTTP ${r.status})` : `HTTP ${r.status}`);
    const j = (await r.json()) as { data?: { id: string }[] };
    return (j.data ?? []).map((m) => m.id);
  }
  if (provider === "gemini") {
    const r = await fetch(`${config.geminiBaseUrl}/models`, {
      headers: { "x-goog-api-key": key },
      signal: AbortSignal.timeout(20000),
    });
    if (!r.ok) throw new Error(r.status === 400 || r.status === 401 || r.status === 403 ? `Gemini rejected the key (HTTP ${r.status})` : `HTTP ${r.status}`);
    const j = (await r.json()) as { models?: { name: string }[] };
    return (j.models ?? []).map((m) => m.name.replace(/^models\//, ""));
  }
  const r = await fetch(`${config.xaiBaseUrl}/models`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(r.status === 401 || r.status === 403 ? `xAI rejected the key (HTTP ${r.status})` : `HTTP ${r.status}`);
  const j = (await r.json()) as { data?: { id: string }[] };
  return (j.data ?? []).map((m) => m.id);
}

/** Test an API key for a specific provider (free /models call). */
export async function testProviderKey(provider: AiProvider): Promise<{ ok: boolean; message: string; source: "admin" | "environment" | "none" }> {
  const [{ key, source, error }, models] = await Promise.all([effectiveProviderKey(provider), effectiveModels(provider)]);
  const label = providerLabel(provider);
  if (!key) return { ok: false, message: `No ${label} key is configured.`, source };
  try {
    countPaid();
    const ids = await listProviderModels(provider, key);
    const configured = [...new Set(Object.values(models))];
    const missing = configured.filter((m) => !ids.includes(m));
    resetModelCache();
    return {
      ok: true,
      message: `${label} key accepted. ${ids.length} models listed${missing.length ? `; not listed: ${missing.join(", ")}` : "; all selected models are available"}.${error ? ` ${error}` : ""}`,
      source,
    };
  } catch (e) {
    return { ok: false, message: redactSecrets((e as Error).message, [key, config.xaiApiKey, config.anthropicApiKey, config.geminiApiKey]), source };
  }
}

/** The dashboard's "Test key" for the active provider (or a specific provider). */
export async function testKey(provider?: AiProvider): Promise<{ ok: boolean; message: string; source: "admin" | "environment" | "none" }> {
  return testProviderKey(provider ?? (await activeProvider()));
}

/** Confirms the active provider's model IDs whenever a key is configured. */
export async function checkModels(): Promise<void> {
  const provider = await activeProvider();
  const [{ key }, models] = await Promise.all([effectiveProviderKey(provider), effectiveModels(provider)]);
  const sig = `${provider}:${key}:${JSON.stringify(models)}`;
  if (!key) {
    const res = initial(provider, models);
    for (const role of Object.keys(res) as ModelRole[]) {
      res[role] = { ...res[role], resolved: res[role].configured, status: "unchecked", note: `no ${providerLabel(provider)} key configured` };
    }
    g.__models = res;
    g.__modelsChecked = undefined;
    g.__modelsSig = undefined;
    return;
  }
  if (g.__modelsChecked && g.__modelsSig === sig) return g.__modelsChecked;
  g.__modelsSig = sig;
  g.__models = initial(provider, models);
  g.__modelsChecked = (async () => {
    const res = g.__models!;
    try {
      const ids = await listProviderModels(provider, key);
      for (const role of Object.keys(res) as ModelRole[]) {
        const want = res[role].configured;
        if (ids.includes(want)) {
          res[role] = { ...res[role], resolved: want, status: "ok", note: `confirmed via ${PROVIDER_META[provider].shortLabel} /models` };
        } else if (provider === "xai") {
          const alt = closestXai(want, ids);
          res[role] = alt
            ? { ...res[role], resolved: alt, status: "substituted", note: `${want} not listed by xAI; using closest current model ${alt}` }
            : { ...res[role], status: "unchecked", note: `${want} not listed and no Grok text model found` };
          console.warn(`[athena] model ${role}: ${res[role].note}`);
        } else {
          res[role] = { ...res[role], resolved: want, status: "unchecked", note: `${want} not in ${PROVIDER_META[provider].shortLabel} /models list (will try as configured)` };
        }
      }
    } catch (e) {
      const msg = redactSecrets((e as Error).message, [key, config.xaiApiKey, config.anthropicApiKey, config.geminiApiKey]);
      for (const role of Object.keys(res) as ModelRole[]) res[role].note = `model check failed: ${msg}`;
      console.warn(`[athena] could not verify ${provider} models:`, msg);
    }
  })();
  return g.__modelsChecked;
}
