import "server-only";
import { and, eq, gte, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { getProject, logDecision, markDownstreamStale, setStageState } from "../project";
import { stageTitle } from "../shared/stages";
import { summariesStep } from "../stages/rules";
import { errMsg } from "../util";
import { startJob } from "./runner";

/*
 * Paper summaries (stage 5) and ranking (stage 6) are one checkpoint for the user. When the summaries are ready,
 * stage 5 is confirmed by the system and the ranking job starts; the user reviews both at stage 6.
 * The rule itself is `summariesStep` (stages/rules.ts); this file applies it to a project.
 */

/**
 * Confirm stage 5 and start ranking when the rule says so. Safe to call at any time: it does nothing unless
 * stage 5 is waiting for review, everything before it is confirmed and no summaries job is active.
 */
export async function settleSummaries(projectId: string, opts: { jobFinished: boolean }): Promise<{ approved: boolean; ranking: boolean }> {
  const p = (await getProject(projectId));
  const step = summariesStep(p.stageStates, opts);
  if (!step.approve) return { approved: false, ranking: false };
  const busy = (await db.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.stage, 5), inArray(schema.jobs.status, ["queued", "running", "paused"]))).get());
  if (busy) return { approved: false, ranking: false };
  (await setStageState(projectId, 5, "approved", { currentStage: 6 }));
  (await logDecision(projectId, 5, "stage_auto_continued", null, { confirmed: stageTitle(5), next: stageTitle(6), rankingStarted: step.rank }, "system"));
  if (step.rank) {
    // Ranking again replaces the scores and the selection, so anything made from the earlier selection is out of date.
    if (p.stageStates["6"] && p.stageStates["6"] !== "not_started") (await markDownstreamStale(projectId, 6, "The papers were ranked again"));
    (await startJob(projectId, "ranking", 6));
  }
  return { approved: true, ranking: step.rank };
}

const SETTLE_POLL_MS = 50;
const SETTLE_TIMEOUT_MS = 30_000;

/**
 * Run `then` once the job runner has finished its own book-keeping for a job whose handler has just returned.
 * The runner marks the job done, sets its stage to "needs review" and logs `job_finished`, in that order, after
 * the handler returns; that log entry is the signal waited for here. A job that failed, paused or was cancelled
 * never triggers `then`. If the wait is cut short (a restart, a timeout), `continueInterruptedChains` and the
 * stage routes pick the chain up from the stored stage states.
 */
export function afterJobSettles(job: { jobId: string; projectId: string; stage: number }, then: () => Promise<unknown>) {
  const started = Date.now();
  const poll = async () => {
    try {
      const j = (await db.select({ status: schema.jobs.status, endedAt: schema.jobs.endedAt }).from(schema.jobs).where(eq(schema.jobs.id, job.jobId)).get());
      if (!j || j.status === "failed" || j.status === "cancelled" || j.status === "paused") return;
      if (j.status === "done" && j.endedAt) {
        const logged = (await db
            .select({ id: schema.decisionLog.id })
            .from(schema.decisionLog)
            .where(and(eq(schema.decisionLog.projectId, job.projectId), eq(schema.decisionLog.stage, job.stage), eq(schema.decisionLog.action, "job_finished"), gte(schema.decisionLog.createdAt, j.endedAt)))
            .get());
        if (logged) {
          await then();
          return;
        }
      }
    } catch (e) {
      console.error(`[athena] could not continue after job ${job.jobId}: ${errMsg(e)}`);
      return;
    }
    if (Date.now() - started < SETTLE_TIMEOUT_MS) setTimeout(poll, SETTLE_POLL_MS);
    else console.warn(`[athena] job ${job.jobId} did not settle in time; its chain continues at the next server start or stage action.`);
  };
  setTimeout(poll, 0);
}

const g = globalThis as unknown as { __chainsContinued?: boolean };

/**
 * Server start: a restart between the end of a summaries job and the start of ranking leaves stage 5 waiting
 * for a review nobody gives. Confirm those and start the ranking that never ran. Called once.
 */
export async function continueInterruptedChains(): Promise<number> {
  if (g.__chainsContinued) return 0;
  g.__chainsContinued = true;
  const rows = (await db.select({ id: schema.projects.id, stageStates: schema.projects.stageStates }).from(schema.projects).all());
  let n = 0;
  for (const r of rows) {
    if (r.stageStates["5"] !== "needs_review") continue;
    try {
      if ((await settleSummaries(r.id, { jobFinished: false })).approved) n++;
    } catch (e) {
      console.error(`[athena] could not continue project ${r.id} after its summaries: ${errMsg(e)}`);
    }
  }
  return n;
}
