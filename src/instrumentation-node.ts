import { config } from "./lib/config";
import { checkModels } from "./lib/ai/models";
import { resumeJobs, resumeJobsPausedForNoKey } from "./lib/jobs";
import { ready } from "./lib/db";
import { ensureAdminFromEnv } from "./lib/auth/server";
import { hasCap } from "./lib/paid-guard";
import { aiState, budgetLimit, effectiveApiKey } from "./lib/settings";

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

// With an API key (admin-set or ANTHROPIC_API_KEY) AI steps spend real money: say so once outside production.
// With no key every AI step pauses before any call, so nothing is spent.
if (!config.production) {
  try {
    const [{ key }, limit] = dbReady ? await Promise.all([effectiveApiKey(), budgetLimit()]) : [{ key: config.anthropicApiKey }, config.budgetUsd];
    if (key) console.warn(`[athena] An API key is set: AI steps will call the Anthropic API and spend real money (${hasCap(limit) ? `server-wide budget $${limit}` : "no server-wide budget cap"}).`);
  } catch (e) {
    console.error("[athena] could not read the key settings:", e);
  }
}

// Server start: confirm the model IDs with the API and resume jobs interrupted by a restart.
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
    // A key added to the environment since: jobs that paused for want of one carry on.
    const ai = await aiState();
    if (ai.enabled && !ai.keyMissing && !ai.budgetReached) await resumeJobsPausedForNoKey();
  } catch (e) {
    console.error("[athena] could not resume interrupted jobs:", e);
  }
}
