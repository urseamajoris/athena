// Password hashing with Node's scrypt (memory-hard, no native dependency). Pure: unit-tested directly.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (pw: string, salt: Buffer, len: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) => scryptCb(pw, salt, len, opts, (e, k) => (e ? reject(e) : resolve(k))));

const N = 16384; // 2^14: ~16 MB per hash, well under serverless memory limits
const R = 8;
const P = 1;
const KEYLEN = 32;

export const PASSWORD_MIN = 10;
export const PASSWORD_MAX = 200;

/** Format: scrypt$N$r$p$<salt b64>$<hash b64>. Parameters travel with the hash so they can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password.normalize("NFKC"), salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], "base64");
  const want = Buffer.from(parts[5], "base64");
  if (![n, r, p].every(Number.isFinite) || !want.length) return false;
  const got = await scrypt(password.normalize("NFKC"), salt, want.length, { N: n, r, p, maxmem: 256 * 1024 * 1024 });
  return got.length === want.length && timingSafeEqual(got, want);
}

/** Why a new password is not acceptable, or null. */
export function passwordProblem(password: string, email?: string): string | null {
  if (password.length < PASSWORD_MIN) return `Use at least ${PASSWORD_MIN} characters.`;
  if (password.length > PASSWORD_MAX) return `Use at most ${PASSWORD_MAX} characters.`;
  if (email && password.toLowerCase().includes(email.split("@")[0].toLowerCase()) && email.split("@")[0].length >= 4) return "Don't include your email name in the password.";
  if (/^(.)\1+$/.test(password)) return "Don't repeat one character.";
  return null;
}
