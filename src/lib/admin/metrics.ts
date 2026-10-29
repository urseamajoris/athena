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

/** Spend per day over the last 7 days (or since the first call), and when the limit runs out at that rate. */
export function projectExhaustion(calls: { createdAt: string; costUsd: number }[], spent: number, limit: number, now: number) {
  const weekAgo = now - 7 * 86_400_000;
  const recent = calls.filter((c) => Date.parse(c.createdAt) >= weekAgo);
  const first = recent.length ? Math.min(...recent.map((c) => Date.parse(c.createdAt))) : now;
  const spanDays = Math.max(1, (now - first) / 86_400_000);
  const perDay = recent.reduce((a, c) => a + c.costUsd, 0) / spanDays;
  const remaining = Math.max(0, limit - spent);
  if (remaining === 0) return { perDay, exhaustedAt: new Date(now).toISOString(), daysLeft: 0 };
  if (perDay <= 0) return { perDay: 0, exhaustedAt: null, daysLeft: null };
  const daysLeft = remaining / perDay;
  return { perDay, exhaustedAt: new Date(now + daysLeft * 86_400_000).toISOString(), daysLeft };
}

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
  sourceErrorRates: { source: string; requests: number; errorRate: number }[];
  keyProblem: string | null;
  modelProblems: string[];
  mockMode: boolean;
  /** Errors reported by users' browsers (page errors and unhandled promise rejections). */
  clientErrorsLastHour?: number;
  topClientError?: { page: string; message: string } | null;
}

/** Green / amber / red, with the reasons in plain words (the "what needs my attention" list). */
export function verdict(i: VerdictInput): { level: Level; reasons: { level: Level; text: string }[] } {
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
  for (const s of i.sourceErrorRates) if (s.requests >= 10 && s.errorRate > 0.25) add("amber", `${s.source} is failing ${Math.round(s.errorRate * 100)}% of requests (last 24 h).`);
  if (i.keyProblem) add("amber", i.keyProblem);
  for (const m of i.modelProblems) add("amber", m);
  const level: Level = reasons.some((r) => r.level === "red") ? "red" : reasons.length ? "amber" : "green";
  if (!reasons.length) reasons.push({ level: "green", text: i.mockMode ? "Demo mode: AI is scripted and nothing is spent. No problems found." : "No problems found." });
  return { level, reasons };
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
