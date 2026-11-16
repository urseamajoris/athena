// Dependency-free errors and rules for when an AI call may not run. Kept out of client.ts (which is server-only
// and needs the database) so the rules can be unit-tested directly.

export class AiValidationError extends Error {
  constructor(message: string, public raw?: string) {
    super(message);
  }
}
export class BudgetError extends Error {}
/** The administrator switched AI off. Nothing was sent and nothing was spent; the work is kept. */
export class AiPausedError extends Error {
  constructor(message = "AI is paused by the administrator. Your work is saved.") {
    super(message);
  }
}
/** No API key is configured. Handled like the AI switch: the job pauses and resumes once a key is added. */
export const NO_KEY_MESSAGE = "AI is not set up on this server yet: no API key is configured. An administrator can add one in the dashboard. Your work is saved.";
export class AiUnavailableError extends AiPausedError {
  constructor() {
    super(NO_KEY_MESSAGE);
  }
}
/** The account that pays for the project has no credits left. The job pauses and resumes once it has some. */
export const NO_CREDITS_MESSAGE = "You are out of credits. Buy more to continue. Your work is saved.";
export class CreditsError extends AiPausedError {
  constructor() {
    super(NO_CREDITS_MESSAGE);
  }
}
/** The model (or a safety check in front of it) would not answer. Nothing is wrong with the server or the key. */
export const DECLINED_MESSAGE = "The AI declined this request. Your work is saved; try again or edit the text.";
export class AiDeclinedError extends Error {
  constructor() {
    super(DECLINED_MESSAGE);
  }
}
/** Errors that must stop a whole job (not just one batch): it pauses or fails cleanly and can be resumed. */
export const isAiStop = (e: unknown) => e instanceof BudgetError || e instanceof AiPausedError;

export type PauseReason = "no_credits" | "no_key" | "ai_off" | "budget";
/** Why a job pauses on this error (recorded in the decision log), or null when the error is not a pause. */
export function pauseReason(e: unknown): PauseReason | null {
  if (e instanceof CreditsError) return "no_credits";
  if (e instanceof AiUnavailableError) return "no_key";
  if (e instanceof AiPausedError) return "ai_off";
  if (e instanceof BudgetError) return "budget";
  return null;
}

/**
 * Why an AI call must not be sent, checked before any network request: the ai_calls row to log (no cost) and
 * the error to throw, or null when the call may go ahead. Checked in this order: the AI switch, the key, then
 * the payer's credits (`canSpend: false` = the account that pays has none left). The server-wide budget is
 * checked after these, by the caller.
 */
export function aiRefusal(s: { enabled: boolean; key: string; canSpend?: boolean }): { row: { status: "paused"; error: string }; error: AiPausedError } | null {
  if (!s.enabled) return { row: { status: "paused", error: "AI switched off by an administrator" }, error: new AiPausedError() };
  if (!s.key) return { row: { status: "paused", error: "no API key configured" }, error: new AiUnavailableError() };
  if (s.canSpend === false) return { row: { status: "paused", error: "out of credits" }, error: new CreditsError() };
  return null;
}
