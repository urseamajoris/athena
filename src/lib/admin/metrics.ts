// Pure helpers behind the admin dashboard (unit-tested in metrics.test.ts). No database access here.
import { STAGES, type StageState } from "../shared/stages";

export function percentile(values: number[], p: number): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const idx = Math.min(v.length - 1, Math.max(0, Math.ceil((p / 100) * v.length) - 1));
  return v[idx];
}

export const dayOf = (iso: string) => iso.slice(0, 10);

/** The last `days` calendar days (UTC) ending today, oldest first, each with the summed value (0 when absent). */
export function dailySeries<T>(rows: T[], days: number, now: number, at: (r: T) => string, value: (r: T) => number = () => 1) {
  const out: { day: string; value: number }[] = [];
  const idx = new Map<string, number>();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(now - i * 86_400_000).toISOString().slice(0, 10);
    idx.set(d, out.length);
    out.push({ day: d, value: 0 });
  }
  for (const r of rows) {
    const i = idx.get(dayOf(at(r)));
    if (i !== undefined) out[i].value += value(r);
  }
  return out;
}

/** Where a project is now: the first stage not yet approved (10 = all nine steps approved). */
export function frontierOf(states: Record<string, StageState>): number {
  return STAGES.find((s) => states[String(s.n)] !== "approved")?.n ?? 10;
}

type ProjectProgress = { stageStates: Record<string, StageState>; status?: string };

/**
 * The furthest stage a project has ever reached (10 = finished all nine steps at least once). Going back to
 * edit an earlier step does not lower it: the later steps turn "out of date", which still counts as reached.
 * Every count on the admin dashboard that says "reached" or "finished" uses this.
 */
export function furthestOf(p: ProjectProgress): number {
  if (p.status === "complete") return 10;
  const started = STAGES.filter((s) => (p.stageStates[String(s.n)] ?? "not_started") !== "not_started").map((s) => s.n);
  return Math.max(frontierOf(p.stageStates), ...started);
}

/** How many projects reached each stage at least once, how many have it approved now, and how many have it out of date. */
export function funnel(projects: ProjectProgress[]) {
  return STAGES.map((s) => ({
    stage: s.n,
    title: s.title,
    reached: projects.filter((p) => furthestOf(p) >= s.n).length,
    approved: projects.filter((p) => p.stageStates[String(s.n)] === "approved").length,
    outOfDate: projects.filter((p) => p.stageStates[String(s.n)] === "stale").length,
  }));
}

/**
 * Finished = finished all nine steps at least once (the funnel's last "reached"). Some of those may have gone
 * back since: `reopened` counts every project now at an earlier step than the furthest it reached.
 */
export function progressCounts(projects: ProjectProgress[]) {
  return {
    finished: projects.filter((p) => furthestOf(p) === 10).length,
    finishedNow: projects.filter((p) => frontierOf(p.stageStates) === 10).length,
    reopened: projects.filter((p) => frontierOf(p.stageStates) < furthestOf(p)).length,
  };
}

/** Unfinished projects idle for `idleDays`, by the stage they are at now: where people give up. */
export function abandonment(projects: { stageStates: Record<string, StageState>; status: string; updatedAt: string }[], now: number, idleDays = 7) {
  const cutoff = now - idleDays * 86_400_000;
  const idle = projects.filter((p) => furthestOf(p) < 10 && Date.parse(p.updatedAt) < cutoff);
  return STAGES.map((s) => ({ stage: s.n, title: s.title, projects: idle.filter((p) => frontierOf(p.stageStates) === s.n).length }));
}

export function projectsPerUser(counts: number[]) {
  const b = { "0": 0, "1": 0, "2–5": 0, "6+": 0 };
  for (const n of counts) b[n === 0 ? "0" : n === 1 ? "1" : n <= 5 ? "2–5" : "6+"]++;
  return Object.entries(b).map(([bucket, users]) => ({ bucket, users }));
}

/** A forecast needs at least this many days of spend history: a two-hour burst is not a daily rate. */
export const FORECAST_MIN_DAYS = 3;

/**
 * Spend per day over the last 7 days, and when the limit runs out at that rate. `historyDays` is how long ago
 * the first of `calls` was made; under FORECAST_MIN_DAYS there is no forecast (`enoughHistory` false), because
 * a few hours of use say nothing about a day. The rate is averaged over the whole window (7 days, or the history
 * when shorter), never over the hours that happened to have calls.
 */
export function projectExhaustion(calls: { createdAt: string; costUsd: number }[], spent: number, limit: number, now: number) {
  const D = 86_400_000;
  const first = calls.length ? Math.min(...calls.map((c) => Date.parse(c.createdAt))) : now;
  const historyDays = Math.max(0, (now - first) / D);
  const windowDays = Math.min(7, Math.max(1, historyDays));
  const recent = calls.filter((c) => Date.parse(c.createdAt) >= now - windowDays * D);
  const perDay = recent.reduce((a, c) => a + c.costUsd, 0) / windowDays;
  const enoughHistory = historyDays >= FORECAST_MIN_DAYS;
  const base = { perDay, windowDays, historyDays, enoughHistory };
  const remaining = Math.max(0, limit - spent);
  if (remaining === 0) return { ...base, exhaustedAt: new Date(now).toISOString(), daysLeft: 0 };
  if (perDay <= 0 || !enoughHistory) return { ...base, exhaustedAt: null, daysLeft: null };
  const daysLeft = remaining / perDay;
  return { ...base, exhaustedAt: new Date(now + daysLeft * D).toISOString(), daysLeft };
}

/**
 * The first `n` rows of a breakdown, with the rest summed into one "other" row, so a chart that shows a few
 * rows still adds up to its total.
 */
export function topRows<R extends { key: string; calls: number; cost: number; failed: number }>(rows: R[], n: number): { key: string; calls: number; cost: number; failed: number }[] {
  if (rows.length <= n) return rows;
  const rest = rows.slice(n - 1);
  const other = rest.reduce((a, r) => ({ ...a, calls: a.calls + r.calls, cost: a.cost + r.cost, failed: a.failed + r.failed }), { key: `other (${rest.length} more)`, calls: 0, cost: 0, failed: 0 });
  return [...rows.slice(0, n - 1), other];
}

/** Display names for the literature sources (the table and the verdict use the same words). */
export const SOURCE_LABEL: Record<string, string> = { pubmed: "PubMed", openalex: "OpenAlex", crossref: "Crossref", unpaywall: "Unpaywall", europepmc: "Europe PMC", pdf: "PDF downloads" };

/**
 * Full-text sources: they are asked for every selected paper, and many papers are not open access, so a share of
 * failures is expected (the appraisal then uses the abstract). Only a majority failing means something broke.
 */
export const FULL_TEXT_SOURCES = new Set(["unpaywall", "europepmc", "pdf"]);

export type Level = "green" | "amber" | "red";
export interface VerdictInput {
  dbOk: boolean;
  requestsLastHour: number;
  errors5xxLastHour: number;
  stuckJobs: number;
  pausedJobs: number;
  aiEnabled: boolean;
  spent: number;
  limit: number;
  sourceErrorRates: { source: string; requests: number; errorRate: number; errors?: number }[];
  keyProblem: string | null;
  modelProblems: string[];
  /** Errors reported by users' browsers (page errors and unhandled promise rejections). */
  clientErrorsLastHour?: number;
  topClientError?: { page: string; message: string } | null;
}

/**
 * Green / amber / red, with the reasons in plain words (the "what needs my attention" list). A green verdict can
 * still carry reasons: things worth a look that are not a fault (`worthALook`), such as a full-text source that
 * fails for papers that are not open access.
 */
export function verdict(i: VerdictInput): { level: Level; worthALook: boolean; reasons: { level: Level; text: string }[] } {
  const reasons: { level: Level; text: string }[] = [];
  const add = (level: Level, text: string) => reasons.push({ level, text });
  if (!i.dbOk) add("red", "The database is not answering.");
  const rate = i.requestsLastHour ? i.errors5xxLastHour / i.requestsLastHour : 0;
  if (i.requestsLastHour >= 20 && rate > 0.05) add("red", `${(rate * 100).toFixed(1)}% of requests failed with a server error in the last hour.`);
  else if (i.errors5xxLastHour > 0) add("amber", `${i.errors5xxLastHour} server error${i.errors5xxLastHour === 1 ? "" : "s"} in the last hour.`);
  const ce = i.clientErrorsLastHour ?? 0;
  if (ce > 0) add("amber", `${ce} error${ce === 1 ? "" : "s"} in users' browsers in the last hour${i.topClientError ? `, most often on ${i.topClientError.page}: "${i.topClientError.message}"` : ""}.`);
  if (i.limit > 0 && i.spent >= i.limit) add("red", "The AI budget is used up: AI steps are stopped for everyone.");
  else if (i.limit > 0 && i.spent >= 0.8 * i.limit) add("amber", `AI spend is at ${Math.round((i.spent / i.limit) * 100)}% of the limit.`);
  if (!i.aiEnabled) add("amber", "AI is switched off: users see a paused message on AI steps.");
  if (i.stuckJobs > 0) add("amber", `${i.stuckJobs} job${i.stuckJobs === 1 ? " has" : "s have"} not reported progress for over 10 minutes.`);
  if (i.pausedJobs > 0) add("amber", `${i.pausedJobs} job${i.pausedJobs === 1 ? " is" : "s are"} paused, waiting for AI or budget.`);
  for (const s of i.sourceErrorRates) {
    const name = SOURCE_LABEL[s.source] ?? s.source;
    const share = `${s.errors !== undefined ? `${s.errors} of ${s.requests} requests, ` : ""}${Math.round(s.errorRate * 100)}%, last 24 h`;
    const fullText = FULL_TEXT_SOURCES.has(s.source);
    if (s.requests >= 10 && s.errorRate > (fullText ? 0.5 : 0.25)) add("amber", `${name} is failing (${share}).`);
    else if (s.requests >= 5 && s.errorRate > 0.1) {
      add("green", fullText
        ? `Worth a look: ${name} failed for some papers (${share}). Usually expected: papers that are not open access have no full text, and their appraisal uses the abstract.`
        : `Worth a look: ${name} failed for some requests (${share}). Failed searches are retried; check the step's log if results look thin.`);
    }
  }
  if (i.keyProblem) add("amber", i.keyProblem);
  for (const m of i.modelProblems) add("amber", m);
  const level: Level = reasons.some((r) => r.level === "red") ? "red" : reasons.some((r) => r.level === "amber") ? "amber" : "green";
  const worthALook = reasons.some((r) => r.level === "green");
  if (!reasons.length) reasons.push({ level: "green", text: "No problems found." });
  return { level, worthALook, reasons };
}

/**
 * A browser error message as it may be stored: no URLs, e-mail addresses, IDs or long quoted text (which could
 * carry a user's words), trimmed to a short line.
 */
export function cleanClientMessage(msg: string): string {
  return msg
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, "<url>")
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "<email>")
    .replace(/(["'`“‘])[^"'`”’]{40,}(["'`”’])/g, "$1…$2")
    .replace(/\b[a-z]{1,4}_[a-z0-9]{6,}\b/gi, "<id>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<id>")
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{12,}\b/gi, "<id>")
    .replace(/\b\d{6,}\b/g, "<id>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 160) || "Unknown error";
}

/** The page a browser error happened on, as a pattern ("/s/:id/export"): never the IDs, never the query string. */
export function pagePattern(path: string): string {
  const segs = path.split(/[?#]/)[0].split("/").filter(Boolean).slice(0, 5);
  return "/" + segs.map((s) => (/^[a-z][a-z-]{0,23}$/.test(s) ? s : ":id")).join("/");
}
