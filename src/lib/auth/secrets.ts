// Secrets at rest and in output. Pure: unit-tested directly.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

/**
 * The AES-256 key from SETTINGS_ENCRYPTION_KEY: 32 bytes as base64 or hex (e.g. `openssl rand -base64 32`),
 * or any other string of at least 32 characters, stretched with HKDF-SHA256. Null when missing or too short.
 */
export function settingsKey(raw: string | undefined | null): Buffer | null {
  const v = raw?.trim();
  if (!v) return null;
  if (/^[0-9a-f]{64}$/i.test(v)) return Buffer.from(v, "hex");
  const b64 = /^[A-Za-z0-9+/_-]+={0,2}$/.test(v) ? Buffer.from(v.replace(/-/g, "+").replace(/_/g, "/"), "base64") : null;
  if (b64 && b64.length === 32) return b64;
  if (v.length < 32) return null;
  return Buffer.from(hkdfSync("sha256", v, "athena-settings", "aes-256-gcm", 32));
}

/** AES-256-GCM. Output: v1:<iv b64>:<tag b64>:<ciphertext b64>. */
export function encryptSecret(plain: string, key: Buffer): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${ct.toString("base64")}`;
}

/** Throws if the ciphertext was altered or the key is wrong. */
export function decryptSecret(blob: string, key: Buffer): string {
  const [v, iv, tag, ct] = blob.split(":");
  if (v !== "v1" || !iv || !tag || ct === undefined) throw new Error("Unrecognised encrypted value");
  const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64")), d.final()]).toString("utf8");
}

/** "••••abcd": the only form of a key that ever leaves the server. */
export function maskKey(key: string): string {
  return key.length <= 4 ? "••••" : `••••${key.slice(-4)}`;
}

/** Short, stable fingerprint (to tell keys apart in the audit log without revealing them). */
export function fingerprint(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

const KEY_PATTERNS = [/\bxai-[A-Za-z0-9_-]{8,}/g, /\bsk-[A-Za-z0-9_-]{8,}/g, /\b(Bearer)\s+[A-Za-z0-9._~+/=-]{12,}/gi];

/** Removes API keys from text bound for logs, the database or a response. `known` = secrets to remove verbatim. */
export function redactSecrets(text: string, known: (string | null | undefined)[] = []): string {
  let out = text;
  for (const k of known) if (k && k.length >= 8) out = out.split(k).join("[redacted]");
  for (const re of KEY_PATTERNS) out = out.replace(re, (_m, bearer?: string) => (bearer && /^bearer$/i.test(bearer) ? `${bearer} [redacted]` : "[redacted]"));
  return out;
}
