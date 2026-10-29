// Pure auth rules shared by the server and the tests.
import { createHash } from "node:crypto";

export const SESSION_COOKIE = "athena_session";
export const SESSION_DAYS = 30;
/** Failed logins allowed per window before further attempts are refused (per email, and per client IP). */
export const LOGIN_WINDOW_MIN = 15;
export const MAX_FAILS_PER_EMAIL = 5;
export const MAX_FAILS_PER_IP = 20;

export const normEmail = (e: string) => e.trim().toLowerCase();
export const hashId = (s: string) => createHash("sha256").update(`athena:${s}`).digest("hex").slice(0, 32);

/** "a•••@example.org": enough for an admin to recognise an account in the audit view. */
export function maskEmail(e: string): string {
  const [u, d] = normEmail(e).split("@");
  if (!d) return "•••";
  return `${u.slice(0, 1)}•••@${d}`;
}

/** Seconds until a login may be tried again, or 0 if allowed. */
export function loginRetryAfter(fails: { email: string[]; ip: string[] }, nowMs: number): number {
  const windowMs = LOGIN_WINDOW_MIN * 60_000;
  const recent = (ts: string[]) => ts.map((t) => Date.parse(t)).filter((t) => nowMs - t < windowMs).sort((a, b) => a - b);
  const e = recent(fails.email);
  const i = recent(fails.ip);
  const wait = (list: number[], max: number) => (list.length >= max ? Math.ceil((list[list.length - max] + windowMs - nowMs) / 1000) : 0);
  return Math.max(wait(e, MAX_FAILS_PER_EMAIL), wait(i, MAX_FAILS_PER_IP), 0);
}

/** Same-origin check for state-changing requests (defence in depth on top of SameSite cookies). */
export function sameOrigin(origin: string | null, host: string | null): boolean {
  if (!origin) return true; // non-browser clients and same-origin GET navigations
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

