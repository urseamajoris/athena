import "server-only";
import { registerJob, startJob, resumeJobs as resumeInterruptedJobs, cancelJob, resumePausedJobs, resumeJobsPausedForNoKey } from "./runner";
import { retrievalJob } from "./retrieval";
import { summariesJob } from "./summaries";
import { rankingJob } from "./ranking";
import { appraisalJob } from "./appraisal";
import { synthesisJob } from "./synthesis";
import { questionsJob } from "./questions";
import { afterJobSettles, continueInterruptedChains, settleSummaries } from "./chain";

registerJob("retrieval", retrievalJob);
// Summaries have no checkpoint of their own: once the runner has recorded the job as finished, stage 5 is
// confirmed and ranking starts (see chain.ts). A job that fails, pauses or is cancelled goes no further.
registerJob("summaries", async (ctx) => {
  await summariesJob(ctx);
  if (!(await ctx.cancelled())) afterJobSettles({ jobId: ctx.jobId, projectId: ctx.projectId, stage: 5 }, () => settleSummaries(ctx.projectId, { jobFinished: true }));
});
registerJob("ranking", rankingJob);
registerJob("appraisal", appraisalJob);
registerJob("synthesis", synthesisJob);
registerJob("questions", questionsJob);

/** Server start: run interrupted jobs again, then continue any summaries-to-ranking chain a restart cut. */
export async function resumeJobs() {
  await resumeInterruptedJobs();
  await continueInterruptedChains();
}

export { startJob, cancelJob, resumePausedJobs, resumeJobsPausedForNoKey, settleSummaries };
