import { randomUUID, createHash } from "node:crypto";

export const newId = (prefix = "") => (prefix ? `${prefix}_` : "") + randomUUID().replace(/-/g, "").slice(0, 16);
export const nowIso = () => new Date().toISOString();
export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

/** Title normalisation used for deduplication. */
export function normalizeTitle(t: string): string {
  return t
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/<[^>]+>/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function normalizeDoi(d: string | null | undefined): string | null {
  if (!d) return null;
  const m = d.trim().toLowerCase().replace(/^https?:\/\/(dx\.)?doi\.org\//, "").replace(/^doi:\s*/, "");
  return m.startsWith("10.") ? m : null;
}

/** Simple counting semaphore for concurrency limits. */
export function limiter(max: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    if (active >= max || queue.length === 0) return;
    active++;
    queue.shift()!();
  };
  return function run<T>(fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn().then(resolve, reject).finally(() => {
          active--;
          next();
        });
      });
      next();
    });
  };
}

export function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export function errMsg(e: unknown): string {
  if (e instanceof Error) {
    // Drizzle wraps driver errors ("Failed query: ..."); the useful part is the cause.
    const cause = (e as { cause?: unknown }).cause;
    return cause instanceof Error && e.message.startsWith("Failed query") ? `${cause.message} (in: ${e.message.slice(14, 80)}…)` : e.message;
  }
  return String(e);
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(parseInt(d, 10)))
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&");
}

export function stripTags(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

/** Sequential async forEach (database writes keep their order). */
export async function forEachSeq<T>(items: readonly T[], fn: (item: T, i: number) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i++) await fn(items[i], i);
}
