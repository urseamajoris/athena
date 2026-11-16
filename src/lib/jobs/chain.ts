import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { getProject, logDecision, markDownstreamStale, setStageState } from "../project";
import { stageTitle } from "../shared/stages";
import { rankAfterSummaries, summariesStep } from "../stages/rules";
import { errMsg } from "../util";
import { startJob } from "./runner";

/*
 * Paper summaries (stage 5) and ranking (stage 6) are one checkpoint for the user: when the summaries are
 * ready, ranking starts by itself and the user reviews both at stage 6. The rules are pure functions in
 * stages/rules.ts (storedStageState, rankAfterSummaries, summariesStep); this file applies them to a project.
 * Stage 5 itself is confirmed where stage states are written (setStageState in project.ts).
 */

/** Ranking again replaces the scores and the choice of papers, so what was made from the earlier choice is out of date. */
async function startRanking(projectId: string, sixBefore: string | undefined) {
  if (sixBefore && sixBefore !== "not_started") (await markDownstreamStale(projectId, 6, "The papers were ranked again"));
  (await startJob(projectId, "ranking", 6));
}

/**
 * Called by the summaries job when its work is done, before the runner records the job as finished: start
 * ranking, so the user never sees the two stages idle in between. The runner then sets stage 5 to "needs
 * review", which is stored as confirmed. Returns whether ranking was started.
 */
export async function rankAfterSummariesJob(projectId: string): Promise<boolean> {
  const p = (await getProject(projectId));
  if (!rankAfterSummaries(p.stageStates)) return false;
  (await logDecision(projectId, 5, "stage_auto_continued", null, { confirmed: stageTitle(5), next: stageTitle(6), rankingStarted: true }, "system"));
  (await startRanking(projectId, p.stageStates["6"]));
  return true;
}

/**
 * At rest: confirm summaries left waiting for a review and start ranking if it has never run. Safe to call at
 * any time; it does nothing unless the rule applies and no summaries job is active.
 */
export async function settleSummaries(projectId: string): Promise<{ approved: boolean; ranking: boolean }> {
  const p = (await getProject(projectId));
  const step = summariesStep(p.stageStates);
  if (!step.approve && !step.rank) return { approved: false, ranking: false };
  const busy = (await db.select({ id: schema.jobs.id }).from(schema.jobs).where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.stage, 5), inArray(schema.jobs.status, ["queued", "running", "paused"]))).get());
  if (busy) return { approved: false, ranking: false };
  if (step.approve) (await setStageState(projectId, 5, "approved", { currentStage: 6 }));
  (await logDecision(projectId, 5, "stage_auto_continued", null, { confirmed: stageTitle(5), next: stageTitle(6), rankingStarted: step.rank }, "system"));
  if (step.rank) (await startRanking(projectId, p.stageStates["6"]));
  return { approved: step.approve, ranking: step.rank };
}

const g = globalThis as unknown as { __chainsContinued?: boolean };

/**
 * Server start: pick up reviews whose summaries are ready but whose ranking never started (a summaries job that
 * ended while an earlier stage was open, or a review made before the two stages were chained). Called once.
 */
export async function continueInterruptedChains(): Promise<number> {
  if (g.__chainsContinued) return 0;
  g.__chainsContinued = true;
  const rows = (await db.select({ id: schema.projects.id, stageStates: schema.projects.stageStates }).from(schema.projects).all());
  let n = 0;
  for (const r of rows) {
    const step = summariesStep(r.stageStates);
    if (!step.approve && !step.rank) continue;
    try {
      const done = (await settleSummaries(r.id));
      if (done.approved || done.ranking) n++;
    } catch (e) {
      console.error(`[athena] could not continue project ${r.id} after its summaries: ${errMsg(e)}`);
    }
  }
  return n;
}
