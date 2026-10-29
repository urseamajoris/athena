// A background job's progress (jobs.progress) and how it is said on the page.
import { fmtInt } from "./format";

export interface Count { done: number; total: number }

/** What a job reports beyond the bar: the AI batches and the papers they hold (each counted in its own unit). */
export interface ProgressDetail {
  batches?: Count;
  papers?: Count;
}

export interface JobProgress extends ProgressDetail {
  /** The bar. With `batches`, the bar may hold one more step after them (e.g. ordering the topics). */
  done: number;
  total: number;
  message: string;
  /** Set by the runner: time since this run's first report, and the batches (or steps) done at that report. A
   *  resumed run starts its own clock, so a pause never makes the estimate look longer. */
  elapsedMs?: number;
  base?: number;
}

/** "about 3 minutes left", or null until at least 2 batches (or steps) were done in this run. */
export function timeLeft(p: JobProgress): string | null {
  const c = p.batches ?? { done: p.done, total: p.total };
  const doneHere = c.done - (p.base ?? 0);
  if (p.elapsedMs == null || doneHere < 2 || c.done >= c.total) return null;
  const ms = ((c.total - c.done) * p.elapsedMs) / doneHere;
  if (ms < 60_000) return "less than a minute left";
  const min = Math.round(ms / 60_000);
  return `about ${min} minute${min === 1 ? "" : "s"} left`;
}

/** "16 of 24 batches · 128 of 225 papers" (or "3 of 10" for a job with no batches). */
export function countLine(p: JobProgress): string {
  const parts = [p.batches ? `${fmtInt(p.batches.done)} of ${fmtInt(p.batches.total)} batches` : `${fmtInt(p.done)} of ${fmtInt(p.total)}`];
  if (p.papers) parts.push(`${fmtInt(p.papers.done)} of ${fmtInt(p.papers.total)} papers`);
  return parts.join(" · ");
}

/** The count line plus the time left once there is a pace to go by: "16 of 24 batches · about 1 minute left". */
export function progressLine(p: JobProgress): string {
  const left = timeLeft(p);
  return left ? `${countLine(p)} · ${left}` : countLine(p);
}
