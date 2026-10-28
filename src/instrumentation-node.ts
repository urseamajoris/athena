import { checkModels } from "./lib/ai/models";
import { resumeJobs } from "./lib/jobs";

// Server start: confirm model IDs with xAI and resume jobs interrupted by a restart.
await checkModels();
resumeJobs();
