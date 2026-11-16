import "server-only";
import { registerJob, startJob, resumeJobs as resumeInterruptedJobs, cancelJob, resumePausedJobs, resumeJobsPausedForNoKey } from "./runner";
import { retrievalJob } from "./retrieval";
import { summariesJob } from "./summaries";
import { rankingJob } from "./ranking";
import { appraisalJob } from "./appraisal";
import { synthesisJob } from "./synthesis";
import { questionsJob } from "./questions";
import { continueInterruptedChains, rankAfterSummariesJob, settleSummaries } from "./chain";
import { errMsg } from "../util";

registerJob("retrieval", retrievalJob);
// Summaries have no checkpoint of their own: when the summaries are written, ranking starts at once (chain.ts),
// and the runner's "finished" then confirms stage 5. A job that fails or pauses throws before this point, and a
// cancelled one is checked for, so none of them starts ranking.
registerJob("summaries", async (ctx) => {
  await summariesJob(ctx);
  if (await ctx.cancelled()) return;
  try {
    await rankAfterSummariesJob(ctx.projectId);
  } catch (e) {
    // The summaries are done either way. Ranking that could not be started here starts at the next stage
    // action or server start (settleSummaries).
    await ctx.log(`Ranking could not be started automatically: ${errMsg(e)}`);
  }
});
registerJob("ranking", rankingJob);
registerJob("appraisal", appraisalJob);
registerJob("synthesis", synthesisJob);
registerJob("questions", questionsJob);

/** Server start: run interrupted jobs again, then start any ranking that is due but never started. */
export async function resumeJobs() {
  await resumeInterruptedJobs();
  await continueInterruptedChains();
}

export { startJob, cancelJob, resumePausedJobs, resumeJobsPausedForNoKey, settleSummaries };
