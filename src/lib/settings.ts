import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { config } from "./config";
import { decryptSecret, encryptSecret, fingerprint, maskKey, settingsKey } from "./auth/secrets";
import { nowIso } from "./util";

/**
 * Runtime settings an admin changes from the dashboard. They live in the database (app_settings), so every
 * server instance sees a change on its next read: nothing is cached across requests.
 */
type SettingKey = "ai_enabled" | "xai_key" | "budget_usd" | "key_test";

interface StoredKey { cipher: string; last4: string; fingerprint: string; setAt: string; setBy: string | null }
export interface KeyTest { ok: boolean; at: string; message: string; source: KeySource }
export type KeySource = "admin" | "environment" | "none";

async function read<T>(key: SettingKey): Promise<{ value: T; updatedAt: string; updatedBy: string | null } | null> {
  const r = await db.select().from(schema.appSettings).where(eq(schema.appSettings.key, key)).get();
  return r ? { value: r.value as T, updatedAt: r.updatedAt, updatedBy: r.updatedBy } : null;
}

async function write(key: SettingKey, value: unknown, by: string | null) {
  const now = nowIso();
  await db.insert(schema.appSettings).values({ key, value, updatedAt: now, updatedBy: by }).onConflictDoUpdate({ target: schema.appSettings.key, set: { value, updatedAt: now, updatedBy: by } }).run();
  aiStateCache = null; // the switch, the limit or the key changed: show it at once on this instance
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

// ---------- xAI key ----------
export class SettingsError extends Error {}

/** Why an admin-set key cannot be stored, or null. */
export function encryptionProblem(): string | null {
  if (!process.env.SETTINGS_ENCRYPTION_KEY?.trim()) return "SETTINGS_ENCRYPTION_KEY is not set on the server, so a key cannot be stored encrypted. Add it (e.g. `openssl rand -base64 32`) and restart.";
  if (!settingsKey(process.env.SETTINGS_ENCRYPTION_KEY)) return "SETTINGS_ENCRYPTION_KEY is too short: use 32 random bytes in base64 or hex, or at least 32 characters.";
  return null;
}

export async function saveXaiKey(plain: string, by: string) {
  const problem = encryptionProblem();
  if (problem) throw new SettingsError(problem);
  const k = settingsKey(process.env.SETTINGS_ENCRYPTION_KEY)!;
  const stored: StoredKey = { cipher: encryptSecret(plain, k), last4: plain.slice(-4), fingerprint: fingerprint(plain), setAt: nowIso(), setBy: by };
  await write("xai_key", stored, by);
  await remove("key_test");
  return { fingerprint: stored.fingerprint };
}

export async function clearXaiKey() {
  await remove("xai_key");
  await remove("key_test");
}

/** The key the AI client uses: admin-set (decrypted) if present, otherwise XAI_API_KEY. Server-side only. */
export async function effectiveXaiKey(): Promise<{ key: string; source: KeySource; error?: string }> {
  const r = await read<StoredKey>("xai_key");
  if (r?.value?.cipher) {
    const k = settingsKey(process.env.SETTINGS_ENCRYPTION_KEY);
    if (!k) return { key: config.xaiApiKey, source: config.xaiApiKey ? "environment" : "none", error: "The admin-set key cannot be read: SETTINGS_ENCRYPTION_KEY is missing. Using the environment key." };
    try {
      return { key: decryptSecret(r.value.cipher, k), source: "admin" };
    } catch {
      return { key: config.xaiApiKey, source: config.xaiApiKey ? "environment" : "none", error: "The admin-set key could not be decrypted (SETTINGS_ENCRYPTION_KEY changed?). Using the environment key." };
    }
  }
  return { key: config.xaiApiKey, source: config.xaiApiKey ? "environment" : "none" };
}

export const recordKeyTest = (t: KeyTest, by: string) => write("key_test", t, by);

/** Everything the dashboard may know about the key. Never the key, never the ciphertext. */
export async function keyStatus() {
  const [stored, test, eff] = await Promise.all([read<StoredKey>("xai_key"), read<KeyTest>("key_test"), effectiveXaiKey()]);
  let setBy: string | null = null;
  if (stored?.value?.setBy) {
    const u = await db.select({ email: schema.users.email }).from(schema.users).where(inArray(schema.users.id, [stored.value.setBy])).get();
    setBy = u?.email ?? "a deleted account";
  }
  return {
    inUse: eff.source,
    masked: eff.key ? maskKey(eff.key) : null,
    problem: eff.error ?? null,
    admin: stored?.value ? { masked: `••••${stored.value.last4}`, setAt: stored.value.setAt, setBy } : null,
    environment: { present: !!config.xaiApiKey, masked: config.xaiApiKey ? maskKey(config.xaiApiKey) : null },
    lastTest: test?.value ?? null,
    encryption: { ready: !encryptionProblem(), problem: encryptionProblem() },
  };
}

/** What every signed-in user may know: whether AI steps can run right now (no amounts, no key details). */
/**
 * For display only (the live-update stream asks every 800 ms per open tab): reused for a few seconds, so open
 * tabs do not sum the whole ai_calls table each time. The AI client checks the budget exactly before each call.
 */
export interface AiState {
  enabled: boolean;
  budgetReached: boolean;
  /** No xAI key is configured (admin-set or XAI_API_KEY): AI steps cannot run until one is added. */
  keyMissing: boolean;
}
let aiStateCache: { at: number; value: Promise<AiState> } | null = null;
const AI_STATE_MS = 5_000;
export function aiState(): Promise<AiState> {
  if (aiStateCache && Date.now() - aiStateCache.at < AI_STATE_MS) return aiStateCache.value;
  const value = (async () => {
    const { totalSpend } = await import("./ai/client");
    const [enabled, limit, spent, { key }] = await Promise.all([aiEnabled(), budgetLimit(), totalSpend(), effectiveXaiKey()]);
    return { enabled, budgetReached: spent >= limit, keyMissing: !key };
  })();
  aiStateCache = { at: Date.now(), value };
  value.catch(() => { aiStateCache = null; });
  return value;
}
