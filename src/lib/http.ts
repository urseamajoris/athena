import "server-only";
import { NextResponse, after } from "next/server";
import { db, schema } from "./db";
import { HttpError } from "./project";
import { AiPausedError, AiValidationError, BudgetError } from "./ai/client";
import { assertSameOrigin, currentUser } from "./auth/server";
import { redactSecrets } from "./auth/secrets";
import { config } from "./config";
import { errMsg, newId } from "./util";

/** Request telemetry is kept this long, then pruned. */
export const RETENTION_DAYS = 14;

export function errorResponse(e: unknown) {
  if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof AiPausedError) return NextResponse.json({ error: e.message, kind: "ai_paused" }, { status: 503 });
  if (e instanceof BudgetError) return NextResponse.json({ error: e.message, kind: "budget" }, { status: 402 });
  if (e instanceof AiValidationError) return NextResponse.json({ error: e.message, kind: "ai_validation" }, { status: 502 });
  const msg = safeError(e);
  console.error("[athena] API error", msg);
  return NextResponse.json({ error: msg }, { status: 500 });
}

/** An error message with any API key removed (env key, admin-set key, and anything key-shaped). */
export function safeError(e: unknown): string {
  return redactSecrets(errMsg(e), [config.xaiApiKey, config.openalexApiKey, process.env.SETTINGS_ENCRYPTION_KEY]);
}

let lastPrune = 0;
function record(route: string, method: string, status: number, started: number, userId: string | null, error: string | null) {
  after(async () => {
    try {
      await db.insert(schema.requestMetrics).values({ id: newId("rq"), route, method, status, durationMs: Date.now() - started, userId, error: error?.slice(0, 300) ?? null }).run();
      if (Date.now() - lastPrune > 3600_000) {
        lastPrune = Date.now();
        const cutoff = new Date(Date.now() - RETENTION_DAYS * 86_400_000).toISOString();
        const { lt } = await import("drizzle-orm");
        await db.delete(schema.requestMetrics).where(lt(schema.requestMetrics.createdAt, cutoff)).run();
        await db.delete(schema.sourceRequests).where(lt(schema.sourceRequests.createdAt, cutoff)).run();
      }
    } catch {
      // Telemetry must never break a request.
    }
  });
}

/**
 * Wraps an API route: same-origin check for writes, uniform error responses (secrets redacted), and one
 * request_metrics row per call (route pattern, method, status, duration; never the body or the URL).
 */
export function apiRoute<C>(route: string, handler: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C): Promise<Response> => {
    const started = Date.now();
    let res: Response;
    let err: string | null = null;
    try {
      await assertSameOrigin(req);
      res = await handler(req, ctx);
    } catch (e) {
      res = errorResponse(e);
      if (res.status >= 500) err = safeError(e);
    }
    const user = await currentUser().catch(() => null);
    record(route, req.method, res.status, started, user?.id ?? null, err);
    return res;
  };
}
