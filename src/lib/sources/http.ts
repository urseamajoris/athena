import "server-only";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { config, countPaid } from "../config";
import { sha256, sleep, nowIso, newId } from "../util";

/**
 * Every outbound HTTP call to a literature API goes through here:
 * - SQLite response cache keyed by sanitised URL (+ body), with a TTL
 * - per-source minimum spacing between requests (rate limits from each API's docs)
 * - exponential backoff on 429 / 5xx / network errors
 */

export type SourceName = "pubmed" | "openalex" | "crossref" | "unpaywall" | "europepmc" | "pdf";

export class SourceError extends Error {
  constructor(public source: SourceName, message: string, public status?: number) {
    super(`${source}: ${message}`);
  }
}

/** Minimum ms between requests per source. */
const SPACING: Record<SourceName, number> = {
  pubmed: config.ncbiApiKey ? 110 : 350, // NCBI: 3 req/s without key, 10 with
  openalex: 120, // well under the documented per-second limit for keyed calls
  crossref: 250, // polite pool, conservative
  unpaywall: 120, // 100k/day; keep it gentle
  europepmc: 150,
  pdf: 500,
};

const lastCall: Record<string, number> = {};
const chains: Record<string, Promise<void>> = {};

async function spacing(source: SourceName) {
  const prev = chains[source] ?? Promise.resolve();
  let release!: () => void;
  chains[source] = new Promise<void>((r) => (release = r));
  await prev;
  const wait = (lastCall[source] ?? 0) + SPACING[source] - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall[source] = Date.now();
  release();
}

const SECRET_PARAMS = ["api_key", "email", "mailto", "tool"];

export function sanitizeUrl(u: string): string {
  const url = new URL(u);
  for (const p of SECRET_PARAMS) url.searchParams.delete(p);
  url.searchParams.sort();
  return url.toString();
}

function cacheKey(source: SourceName, url: string, body?: string) {
  return `${source}:${sha256(sanitizeUrl(url) + (body ? `|${body}` : ""))}`;
}

export interface FetchOpts {
  method?: "GET" | "POST";
  body?: string;
  headers?: Record<string, string>;
  ttlHours?: number;
  /** Return binary (base64) instead of text. */
  binary?: boolean;
  /** Treat these statuses as a valid (cacheable) answer rather than an error. */
  okStatuses?: number[];
  maxRetries?: number;
  log?: (line: string) => void;
}

export interface HttpResult {
  status: number;
  text: string;
  contentType: string | null;
  cached: boolean;
}

/** One source_requests row per request attempt, cache hit or simulated failure (admin telemetry). */
function track(source: SourceName, row: { status: number; ok: boolean; cached?: boolean; simulated?: boolean; ms?: number }) {
  void db
    .insert(schema.sourceRequests)
    .values({ id: newId("sr"), source, status: row.status, ok: row.ok, cached: !!row.cached, simulated: !!row.simulated, durationMs: Math.round(row.ms ?? 0) })
    .run()
    .catch(() => {});
}

export async function httpFetch(source: SourceName, url: string, opts: FetchOpts = {}): Promise<HttpResult> {
  if (config.simulateFailure.includes(source)) {
    track(source, { status: 503, ok: false, simulated: true });
    throw new SourceError(source, "simulated failure (SIMULATE_SOURCE_FAILURE)", 503);
  }
  const okStatuses = [200, ...(opts.okStatuses ?? [])];
  const key = cacheKey(source, url, opts.body);
  const safeUrl = sanitizeUrl(url);

  const hit = (await db.select().from(schema.httpCache).where(eq(schema.httpCache.key, key)).get());
  if (hit && hit.expiresAt > nowIso()) {
    track(source, { status: hit.status, ok: okStatuses.includes(hit.status) || hit.status === 404, cached: true });
    opts.log?.(`[cache] ${safeUrl}`);
    if (!okStatuses.includes(hit.status)) throw new SourceError(source, `HTTP ${hit.status} (cached)`, hit.status);
    return { status: hit.status, text: hit.body, contentType: hit.contentType, cached: true };
  }

  if (source === "openalex" && config.openalexApiKey) countPaid();
  const maxRetries = opts.maxRetries ?? 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await spacing(source);
    const t0 = Date.now();
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        body: opts.body,
        headers: {
          "User-Agent": `Athena-LitReview-Prototype/0.1 (mailto:${config.contactEmail || "unknown"})`,
          ...(opts.headers ?? {}),
        },
        signal: AbortSignal.timeout(45000),
      });
      // A 404 is a definite "not found" (e.g. no open PDF for this DOI), not a failure of the source.
      track(source, { status: res.status, ok: okStatuses.includes(res.status) || res.status === 404, ms: Date.now() - t0 });
      if (res.status === 429 || res.status >= 500) {
        const ra = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30000) : Math.min(1000 * 2 ** attempt, 16000);
        opts.log?.(`${source} HTTP ${res.status}; backing off ${wait}ms (attempt ${attempt + 1})`);
        lastErr = new SourceError(source, `HTTP ${res.status}`, res.status);
        await sleep(wait);
        continue;
      }
      const contentType = res.headers.get("content-type");
      const text = opts.binary ? Buffer.from(await res.arrayBuffer()).toString("base64") : await res.text();
      opts.log?.(`${opts.method ?? "GET"} ${safeUrl} → ${res.status}`);
      if (okStatuses.includes(res.status) || res.status === 404) {
        // Cache successes and definitive 404s (but not PDFs: we never store PDFs).
        if (source !== "pdf") {
          const expires = new Date(Date.now() + (opts.ttlHours ?? config.cacheTtlHours) * 3600_000).toISOString();
          (await db.insert(schema.httpCache)
                        .values({ key, url: safeUrl, status: res.status, contentType, body: text, expiresAt: expires })
                        .onConflictDoUpdate({ target: schema.httpCache.key, set: { status: res.status, body: text, contentType, expiresAt: expires, createdAt: nowIso() } })
                        .run());
        }
      }
      if (!okStatuses.includes(res.status)) {
        throw new SourceError(source, `HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
      }
      return { status: res.status, text, contentType, cached: false };
    } catch (e) {
      if (!(e instanceof SourceError)) track(source, { status: 0, ok: false, ms: Date.now() - t0 });
      if (e instanceof SourceError && e.status && e.status < 500 && e.status !== 429) throw e;
      lastErr = e;
      const wait = Math.min(1000 * 2 ** attempt, 16000);
      opts.log?.(`${source} network error (${(e as Error).message}); retry in ${wait}ms`);
      await sleep(wait);
    }
  }
  throw lastErr instanceof SourceError ? lastErr : new SourceError(source, `failed after retries: ${(lastErr as Error)?.message ?? lastErr}`);
}

export async function httpJson<T = unknown>(source: SourceName, url: string, opts: FetchOpts = {}): Promise<T> {
  const r = await httpFetch(source, url, opts);
  try {
    return JSON.parse(r.text) as T;
  } catch {
    throw new SourceError(source, "response was not valid JSON");
  }
}
