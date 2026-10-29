import "server-only";
import { db, schema } from "../db";
import { newId } from "../util";
import { cleanClientMessage, pagePattern } from "./metrics";

/**
 * Errors reported by users' browsers, stored as request_metrics rows (method BROWSER, status 0) so they share the
 * telemetry retention. Each row is one occurrence: the page pattern and a cleaned short message. No user ID, no
 * URL, no stack, no request body.
 */
export const BROWSER = "BROWSER";
export const CLIENT_ERROR_KINDS = ["error", "unhandledrejection"] as const;

const PER_USER_PER_MIN = 10;
const ALL_PER_MIN = 120;
const g = globalThis as unknown as { __clientErrWindow?: { start: number; all: number; byUser: Map<string, number> } };

/** Fixed one-minute window per instance: a broken page in a loop cannot flood the table. */
function allowed(userId: string): boolean {
  const now = Date.now();
  if (!g.__clientErrWindow || now - g.__clientErrWindow.start > 60_000) g.__clientErrWindow = { start: now, all: 0, byUser: new Map() };
  const w = g.__clientErrWindow;
  const mine = w.byUser.get(userId) ?? 0;
  if (w.all >= ALL_PER_MIN || mine >= PER_USER_PER_MIN) return false;
  w.all++;
  w.byUser.set(userId, mine + 1);
  return true;
}

/** Records one browser error; false when it was dropped by the rate limit. */
export async function recordClientError(userId: string, e: { kind: (typeof CLIENT_ERROR_KINDS)[number]; message: string; page: string }): Promise<boolean> {
  if (!allowed(userId)) return false;
  const message = `${e.kind === "unhandledrejection" ? "Unhandled promise rejection" : "Page error"}: ${cleanClientMessage(e.message)}`;
  await db.insert(schema.requestMetrics).values({ id: newId("rq"), route: pagePattern(e.page), method: BROWSER, status: 0, durationMs: 0, userId: null, error: message.slice(0, 200) }).run();
  return true;
}
