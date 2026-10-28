import "server-only";
import fs from "node:fs";
import path from "node:path";
import { eq } from "drizzle-orm";
import { db, schema } from "../db";
import { config } from "../config";
import { sha256, sleep, nowIso } from "../util";

/**
 * Every outbound HTTP call to a literature API goes through here:
 * - SQLite response cache keyed by sanitised URL (+ body), with a TTL
 * - per-source minimum spacing between requests (rate limits from each API's docs)
 * - exponential backoff on 429 / 5xx / network errors
 * - MOCK_MODE: served from fixtures/http (exact key, else a fixture recorded for the same endpoint)
 * - RECORD_FIXTURES: writes responses to fixtures/http with keys and email removed
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

const FIXTURE_DIR = path.resolve(process.cwd(), "fixtures/http");

interface Fixture {
  source: SourceName;
  route: string;
  url: string;
  body?: string;
  status: number;
  contentType: string | null;
  response: string;
}

function routeOf(url: string) {
  const u = new URL(url);
  // Collapse IDs in paths so /works/10.x/... and /PMC123/fullTextXML share a route.
  const p = u.pathname
    .replace(/\/10\.\d{4,9}\/.*$/i, "/:doi")
    .replace(/PMC\d+/g, ":pmcid")
    .replace(/\/W\d+/g, "/:id");
  return `${u.host}${p}`;
}

let fixtureIndex: Map<string, Fixture[]> | null = null;
function loadFixtures() {
  if (fixtureIndex) return fixtureIndex;
  fixtureIndex = new Map();
  if (!fs.existsSync(FIXTURE_DIR)) return fixtureIndex;
  for (const f of fs.readdirSync(FIXTURE_DIR)) {
    if (!f.endsWith(".json")) continue;
    try {
      const fx = JSON.parse(fs.readFileSync(path.join(FIXTURE_DIR, f), "utf8")) as Fixture;
      const exact = `exact:${cacheKey(fx.source, fx.url, fx.body)}`;
      fixtureIndex.set(exact, [fx]);
      const r = `route:${fx.route}`;
      if (!fixtureIndex.has(r)) fixtureIndex.set(r, []);
      fixtureIndex.get(r)!.push(fx);
    } catch {
      /* ignore broken fixture */
    }
  }
  return fixtureIndex;
}

function mockResponse(source: SourceName, url: string, body?: string): { status: number; text: string; contentType: string | null } {
  const idx = loadFixtures();
  const exact = idx.get(`exact:${cacheKey(source, url, body)}`);
  if (exact) return { status: exact[0].status, text: exact[0].response, contentType: exact[0].contentType };
  const byRoute = idx.get(`route:${routeOf(url)}`);
  if (byRoute && byRoute.length) {
    // Single-record lookups (a DOI, a PMCID) must not borrow another record's data.
    if (/:doi$|:pmcid|\/:id$/.test(routeOf(url))) return { status: 404, text: "{}", contentType: "application/json" };
    const ok = byRoute.filter((f) => f.status === 200);
    const pool = ok.length ? ok : byRoute;
    const pick = pool[parseInt(sha256(sanitizeUrl(url)).slice(0, 8), 16) % pool.length];
    return { status: pick.status, text: pick.response, contentType: pick.contentType };
  }
  return { status: 404, text: "{}", contentType: "application/json" };
}

function recordFixture(source: SourceName, url: string, body: string | undefined, status: number, contentType: string | null, text: string) {
  if (!config.recordFixtures || config.mockMode) return;
  if (source === "pdf") return; // never write PDFs/derived PDF text into fixtures
  fs.mkdirSync(FIXTURE_DIR, { recursive: true });
  let response = text;
  if (config.contactEmail) response = response.split(config.contactEmail).join("contact@example.org");
  const fx: Fixture = { source, route: routeOf(url), url: sanitizeUrl(url), body, status, contentType, response };
  const name = `${source}-${sha256(fx.url + (body ?? "")).slice(0, 16)}.json`;
  fs.writeFileSync(path.join(FIXTURE_DIR, name), JSON.stringify(fx));
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

export async function httpFetch(source: SourceName, url: string, opts: FetchOpts = {}): Promise<HttpResult> {
  if (config.simulateFailure.includes(source)) {
    throw new SourceError(source, "simulated failure (SIMULATE_SOURCE_FAILURE)", 503);
  }
  const okStatuses = [200, ...(opts.okStatuses ?? [])];
  const key = cacheKey(source, url, opts.body);
  const safeUrl = sanitizeUrl(url);

  if (config.mockMode) {
    const m = mockResponse(source, url, opts.body);
    opts.log?.(`[mock] ${opts.method ?? "GET"} ${safeUrl} → ${m.status}`);
    if (!okStatuses.includes(m.status)) throw new SourceError(source, `HTTP ${m.status} (mock fixture)`, m.status);
    return { status: m.status, text: m.text, contentType: m.contentType, cached: true };
  }

  const hit = db.select().from(schema.httpCache).where(eq(schema.httpCache.key, key)).get();
  if (hit && hit.expiresAt > nowIso()) {
    opts.log?.(`[cache] ${safeUrl}`);
    if (!okStatuses.includes(hit.status)) throw new SourceError(source, `HTTP ${hit.status} (cached)`, hit.status);
    return { status: hit.status, text: hit.body, contentType: hit.contentType, cached: true };
  }

  const maxRetries = opts.maxRetries ?? 4;
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    await spacing(source);
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
          db.insert(schema.httpCache)
            .values({ key, url: safeUrl, status: res.status, contentType, body: text, expiresAt: expires })
            .onConflictDoUpdate({ target: schema.httpCache.key, set: { status: res.status, body: text, contentType, expiresAt: expires, createdAt: nowIso() } })
            .run();
          recordFixture(source, url, opts.body, res.status, contentType, text);
        }
      }
      if (!okStatuses.includes(res.status)) {
        throw new SourceError(source, `HTTP ${res.status}: ${text.slice(0, 200)}`, res.status);
      }
      return { status: res.status, text, contentType, cached: false };
    } catch (e) {
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
