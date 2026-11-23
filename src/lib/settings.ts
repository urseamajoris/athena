import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { config, envKeyFor, type AiProvider, type ModelRole } from "./config";
import { AI_PROVIDERS, isAiProvider, MODEL_ROLES, PROVIDER_META, type ProviderConfigStatus, type ProviderKeyInfo } from "./shared/ai-providers";
import { decryptSecret, encryptSecret, fingerprint, maskKey, settingsKey } from "./auth/secrets";
import { nowIso } from "./util";

/**
 * Runtime settings an admin changes from the dashboard or canvas. They live in the database (app_settings),
 * so every server instance sees a change on its next read: nothing is cached across requests.
 */
type SettingKey =
  | "ai_enabled"
  | "ai_provider"
  | "ai_models"
  | "xai_key"
  | "anthropic_key"
  | "gemini_key"
  | "budget_usd"
  | "key_test"
  | "anthropic_key_test"
  | "gemini_key_test";

interface StoredKey { cipher: string; last4: string; fingerprint: string; setAt: string; setBy: string | null }
export interface KeyTest { ok: boolean; at: string; message: string; source: KeySource }
export type KeySource = "admin" | "environment" | "none";

const KEY_SETTING: Record<AiProvider, SettingKey> = {
  xai: "xai_key",
  anthropic: "anthropic_key",
  gemini: "gemini_key",
};

const TEST_SETTING: Record<AiProvider, SettingKey> = {
  xai: "key_test",
  anthropic: "anthropic_key_test",
  gemini: "gemini_key_test",
};

async function read<T>(key: SettingKey): Promise<{ value: T; updatedAt: string; updatedBy: string | null } | null> {
  const r = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  return r ? { value: r.value as T, updatedAt: r.updatedAt, updatedBy: r.updatedBy } : null;
}

async function write(key: SettingKey, value: unknown, by: string | null) {
  const now = nowIso();
  await db.insert(schema.appSettings).values({ key, value, updatedAt: now, updatedBy: by }).onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: now, updatedBy: by } }).run();
  aiStateCache = null; // the switch, provider, model, limit or key changed: show it at once on this instance
}

async function remove(key: SettingKey) {
  await db.delete(schema.appSettings).where(eq(schema.appSettings.key, key)).run();
  aiStateCache = null;
}

// ---------- AI on/off ----------
export async function aiEnabled(): Promise<boolean> {
  return (await read<boolean>("ai_enabled"))?.value !== false;
}
export async function aiSwitch() {
  const r = await read<boolean>("ai_enabled");
  return { enabled: r?.value !== false, changedAt: r?.updatedAt ?? null, changedBy: r?.updatedBy ?? null };
}
export const setAiEnabled = (enabled: boolean, by: string) => write("ai_enabled", enabled, by);

// ---------- AI provider & pipeline models ----------
export async function activeProvider(): Promise<AiProvider> {
  const r = await read<string>("ai_provider");
  if (isAiProvider(r?.value)) return r.value;
  return config.defaultProvider;
}

export const setActiveProvider = (provider: AiProvider, by: string) => write("ai_provider", provider, by);

type StoredModels = Partial<Record<AiProvider, Partial<Record<ModelRole, string>>>>;

async function storedModels(): Promise<StoredModels> {
  const r = await read<StoredModels>("ai_models");
  return r?.value && typeof r.value === "object" ? r.value : {};
}

export async function effectiveModels(provider?: AiProvider): Promise<Record<ModelRole, string>> {
  const p = provider ?? (await activeProvider());
  const base = config.providerModels[p] ?? PROVIDER_META[p].defaultModels;
  const custom = (await storedModels())[p] ?? {};
  return {
    fast: custom.fast?.trim() || base.fast,
    summary: custom.summary?.trim() || base.summary,
    reasoning: custom.reasoning?.trim() || base.reasoning,
  };
}

export async function setProviderModels(provider: AiProvider, patch: Partial<Record<ModelRole, string | null>>, by: string) {
  const all = await storedModels();
  const prev = { ...(all[provider] ?? {}) };
  for (const role of MODEL_ROLES) {
    if (!(role in patch)) continue;
    const v = patch[role];
    if (v === null || v === "") delete prev[role];
    else if (typeof v === "string") prev[role] = v.trim();
  }
  const next: StoredModels = { ...all, [provider]: prev };
  await write("ai_models", next, by);
  return effectiveModels(provider);
}

// ---------- budget ----------
/** The spend limit in force: the admin's limit if one is set, else XAI_BUDGET_USD. */
export async function budgetLimit(): Promise<number> {
  const r = await read<number>("budget_usd");
  return typeof r?.value === "number" && Number.isFinite(r.value) ? r.value : config.budgetUsd;
}
export async function budgetSetting() {
  const r = await read<number>("budget_usd");
  return { limitUsd: await budgetLimit(), envUsd: config.budgetUsd, override: typeof r?.value === "number", changedAt: r?.updatedAt ?? null, changedBy: r?.updatedBy ?? null };
}
export const setBudget = (usd: number, by: string) => write("budget_usd", usd, by);
export const clearBudget = () => remove("budget_usd");

// ---------- API keys (per provider) ----------
export class SettingsError extends Error {}

/** Why an admin-set key cannot be stored, or null. */
export function encryptionProblem(): string | null {
  if (!process.env.SETTINGS_ENCRYPTION_KEY?.trim()) return "SETTINGS_ENCRYPTION_KEY is not set on the server, so a key cannot be stored encrypted. Add it (e.g. `openssl rand -base64 32`) and restart.";
  if (!settingsKey(process.env.SETTINGS_ENCRYPTION_KEY)) return "SETTINGS_ENCRYPTION_KEY is too short: use 32 random bytes in base64 or hex, or at least 32 characters.";
  return null;
}

export async function saveProviderKey(provider: AiProvider, plain: string, by: string) {
  const problem = encryptionProblem();
  if (problem) throw new SettingsError(problem);
  const k = settingsKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
  const stored: StoredKey = { cipher: encryptSecret(plain, k), last4: plain.slice(-4), fingerprint: fingerprint(plain), setAt: nowIso(), setBy: by };
  await write(KEY_SETTING[provider], stored, by);
  await remove(TEST_SETTING[provider]);
  return { fingerprint: stored.fingerprint };
}

export async function clearProviderKey(provider: AiProvider) {
  await remove(KEY_SETTING[provider]);
  await remove(TEST_SETTING[provider]);
}

/** The key the AI client uses for `provider`: admin-set (decrypted) if present, otherwise the env var. Server-side only. */
export async function effectiveProviderKey(provider?: AiProvider): Promise<{ key: string; source: KeySource; error?: string; provider: AiProvider }> {
  const p = provider ?? (await activeProvider());
  const envKey = envKeyFor(p);
  const r = await read<StoredKey>(KEY_SETTING[p]);
  if (r?.value?.cipher) {
    const k = settingsKey(process.env.SETTINGS_ENCRYPTION_KEY);
    if (!k) return { key: envKey, source: envKey ? "environment" : "none", error: "The admin-set key cannot be read: SETTINGS_ENCRYPTION_KEY is missing. Using the environment key.", provider: p };
    try {
      return { key: decryptSecret(r.value.cipher, k), source: "admin", provider: p };
    } catch {
      return { key: envKey, source: envKey ? "environment" : "none", error: "The admin-set key could not be decrypted (SETTINGS_ENCRYPTION_KEY changed?). Using the environment key.", provider: p };
    }
  }
  return { key: envKey, source: envKey ? "environment" : "none", provider: p };
}

export const recordProviderKeyTest = (provider: AiProvider, t: KeyTest, by: string) => write(TEST_SETTING[provider], t, by);

/** Backwards-compatible xAI helpers. */
export const saveXaiKey = (plain: string, by: string) => saveProviderKey("xai", plain, by);
export const clearXaiKey = () => clearProviderKey("xai");
export const effectiveXaiKey = () => effectiveProviderKey("xai");
export const recordKeyTest = (t: KeyTest, by: string) => recordProviderKeyTest("xai", t, by);

/** Everything the dashboard may know about one provider's key. Never the key, never the ciphertext. */
export async function providerKeyStatus(provider: AiProvider): Promise<ProviderKeyInfo> {
  const [stored, test, eff] = await Promise.all([read<StoredKey>(KEY_SETTING[provider]), read<KeyTest>(TEST_SETTING[provider]), effectiveProviderKey(provider)]);
  let setBy: string | null = null;
  if (stored?.value?.setBy) {
    const u = await db.select({ email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, [stored.value.setBy])).get();
    setBy = u?.email ?? "a deleted account";
  }
  const envKey = envKeyFor(provider);
  return {
    inUse: eff.source,
    masked: eff.key ? maskKey(eff.key) : null,
    problem: eff.error ?? null,
    admin: stored?.value ? { masked: `••••${stored.value.last4}`, setAt: stored.value.setAt, setBy } : null,
    environment: { present: !!envKey, masked: envKey ? maskKey(envKey) : null },
    lastTest: test?.value ?? null,
  };
}

/** Active provider's key status (compatible with the original keyStatus shape). */
export async function keyStatus(provider?: AiProvider) {
  const p = provider ?? (await activeProvider());
  const info = await providerKeyStatus(p);
  return {
    ...info,
    provider: p,
    encryption: { ready: !encryptionProblem(), problem: encryptionProblem() },
  };
}

/** Full multi-provider configuration status for the Admin Dashboard and Canvas Admin AI Box. */
export async function providerConfigStatus(): Promise<ProviderConfigStatus> {
  const [active, customAll] = await Promise.all([activeProvider(), storedModels()]);
  const entries = await Promise.all(
    AI_PROVIDERS.map(async (p) => {
      const [key, models] = await Promise.all([providerKeyStatus(p), effectiveModels(p)]);
      return [p, { key, models, customModels: customAll[p] ?? {} }] as const;
    }),
  );
  const providers = Object.fromEntries(entries) as ProviderConfigStatus["providers"];
  return {
    activeProvider: active,
    activeModels: providers[active].models,
    encryption: { ready: !encryptionProblem(), problem: encryptionProblem() },
    providers,
  };
}

/** What every signed-in user may know: whether AI steps can run right now (no amounts, no key details). */
export interface AiState {
  enabled: boolean;
  budgetReached: boolean;
  /** No API key is configured for the active provider: AI steps cannot run until one is added. */
  keyMissing: boolean;
  provider: AiProvider;
  activeModel: string;
}
let aiStateCache: { at: number; value: Promise<AiState> } | null = null;
const AI_STATE_MS = 5_000;
export function aiState(): Promise<AiState> {
  if (aiStateCache && Date.now() - aiStateCache.at < AI_STATE_MS) return aiStateCache.value;
  const value = (async () => {
    const { totalSpend } = await import("./ai/client");
    const provider = await activeProvider();
    const [enabled, limit, spent, { key }, models] = await Promise.all([aiEnabled(), budgetLimit(), totalSpend(), effectiveProviderKey(provider), effectiveModels(provider)]);
    return { enabled, budgetReached: spent >= limit, keyMissing: !key, provider, activeModel: models.reasoning };
  })();
  aiStateCache = { at: Date.now(), value };
  value.catch(() => { aiStateCache = null; });
  return value;
}
