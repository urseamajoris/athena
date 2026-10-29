// Scripts never spend money. Every script that drives a server checks /api/status first and refuses to run if
// the server has an xAI key: with no key every AI step stops before any request to xAI, so nothing a script does
// can cost anything. (Scripts that start their own server also strip XAI_API_KEY and OPENALEX_API_KEY from it.)
import { Client } from "./client.mjs";

/** Why this /api/status answer means the server could spend money, or null when it has no xAI key. */
export function keyProblem(status) {
  if (!status || typeof status !== "object") return "/api/status did not answer with JSON";
  if (status.keys?.xai === true) return "an xAI key is in force (from the server's environment or set by an admin in the dashboard)";
  if (status.ai?.keyMissing === false) return "an xAI key is configured (in the server's environment or set by an admin in the dashboard)";
  if (status.ai?.keyMissing !== true) return "the server does not say whether an xAI key is configured (no ai.keyMissing in /api/status; is it an older build?)";
  return null;
}

/** Stops the script (exit code 2) with the reason when the server has an xAI key. */
export function refuseIfKey(status, base) {
  const why = keyProblem(status);
  if (!why) return status;
  console.error(`Refusing to run against ${base}: ${why}.`);
  console.error("With a key, AI steps call xAI and spend real money. Start the server with XAI_API_KEY empty (an unset one is filled from .env) and clear any key set in the admin dashboard, then run this again.");
  process.exit(2);
}

/**
 * Reads /api/status (as the admin when ADMIN_EMAIL / ADMIN_PASSWORD are set, so the environment key is visible
 * too; otherwise as a fresh throwaway account, or as `client` when given) and refuses to go on if the server has
 * an xAI key. Returns the status and the client that read it.
 */
export async function requireNoKey(base, client) {
  let c = client;
  try {
    if (!c && process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) c = await new Client(base, "admin").login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
    if (!c) c = await new Client(base, "precheck").signup(`precheck-${Date.now()}@example.org`);
  } catch (e) {
    console.error(`Refusing to run against ${base}: could not sign in to read /api/status (${e.message}).`);
    process.exit(2);
  }
  let status;
  try {
    status = await c.json("/api/status");
  } catch (e) {
    console.error(`Refusing to run against ${base}: could not read /api/status (${e.message}).`);
    process.exit(2);
  }
  refuseIfKey(status, base);
  return { status, client: c };
}

/** The browser logs "Failed to load resource … 503" for every refused AI step: expected here, not an app error. */
export function isAiRefusalLog(text, url, refusedUrls) {
  return /status of 503/.test(text) && refusedUrls.has(url);
}
