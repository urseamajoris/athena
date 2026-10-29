import { config } from "./lib/config";
import { startupProblem } from "./lib/paid-guard";
import { checkModels } from "./lib/ai/models";
import { resumeJobs } from "./lib/jobs";
import { ready } from "./lib/db";

// Refuse to start in a configuration that would spend money outside production.
const problem = startupProblem(config);
if (problem) {
  console.error(`\n[athena] REFUSING TO START: ${problem}\n`);
  throw new Error(problem);
}
if (config.mockMode && (config.xaiApiKey || config.openalexApiKey)) {
  console.warn("[athena] Mock mode: API keys are present in the environment but will not be used.");
}

// Apply database migrations (local file or Turso) before anything reads the database.
await ready();

// Server start: confirm model IDs with xAI and resume jobs interrupted by a restart.
await checkModels();
(await resumeJobs());
