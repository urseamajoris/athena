import "server-only";
import { registerJob, startJob, resumeJobs, cancelJob, resumePausedJobs, resumeJobsPausedForNoKey } from "./runner";
import { retrievalJob } from "./retrieval";
import { summariesJob } from "./summaries";
import { rankingJob } from "./ranking";
import { appraisalJob } from "./appraisal";
import { synthesisJob } from "./synthesis";
import { questionsJob } from "./questions";

registerJob("retrieval", retrievalJob);
registerJob("summaries", summariesJob);
registerJob("ranking", rankingJob);
registerJob("appraisal", appraisalJob);
registerJob("synthesis", synthesisJob);
registerJob("questions", questionsJob);

export { startJob, resumeJobs, cancelJob, resumePausedJobs, resumeJobsPausedForNoKey };
