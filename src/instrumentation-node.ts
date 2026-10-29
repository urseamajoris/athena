import { config } from "./lib/config";
import { startupProblem } from "./lib/paid-guard";
import { checkModels } from "./lib/ai/models";
import { resumeJobs } from "./lib/jobs";
import { ready } from "./lib/db";
import { ensureAdminFromEnv } from "./lib/auth/server";

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
// A remote database (Turso) can time out on a cold start: retry, and never crash the server over it
// (a failed hook turns every request on this instance into a 500).
let dbReady = false;
for (let attempt = 1; attempt <= 3 && !dbReady; attempt++) {
  try {
    await ready();
    dbReady = true;
  } catch (e) {
    console.error(`[athena] database not ready (attempt ${attempt}/3):`, e);
    if (attempt < 3) await new Promise((r) => setTimeout(r, 500 * attempt));
  }
}

// Server start: confirm model IDs with xAI and resume jobs interrupted by a restart.
try {
  await checkModels();
} catch (e) {
  // It reads the key settings from the database, which may be the very thing that is down.
  console.error("[athena] could not check the model IDs:", e);
}
if (dbReady) {
  try {
    // First admin from ADMIN_EMAIL / ADMIN_PASSWORD; projects from before accounts go to that admin.
    await ensureAdminFromEnv();
  } catch (e) {
    console.error("[athena] could not set up the admin account:", e);
  }
  try {
    await resumeJobs();
  } catch (e) {
    console.error("[athena] could not resume interrupted jobs:", e);
  }
}
