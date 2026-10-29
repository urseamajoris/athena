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
/** No xAI key is configured. Handled like the AI switch: the job pauses and resumes once a key is added. */
export class AiUnavailableError extends AiPausedError {
  constructor() {
    super("AI is not set up on this server yet: no xAI API key is configured. An administrator can add one in the dashboard. Your work is saved.");
  }
}
/** Errors that must stop a whole job (not just one batch): it pauses or fails cleanly and can be resumed. */
export const isAiStop = (e: unknown) => e instanceof BudgetError || e instanceof AiPausedError;

/**
 * Why an AI call must not be sent, checked before any network request: the ai_calls row to log (no cost) and
 * the error to throw, or null when the call may go ahead. The switch is checked first, then the key.
 */
export function aiRefusal(s: { enabled: boolean; key: string }): { row: { status: "paused"; error: string }; error: AiPausedError } | null {
  if (!s.enabled) return { row: { status: "paused", error: "AI switched off by an administrator" }, error: new AiPausedError() };
  if (!s.key) return { row: { status: "paused", error: "no xAI API key configured" }, error: new AiUnavailableError() };
  return null;
}
