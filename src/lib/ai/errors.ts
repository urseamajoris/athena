// Dependency-free errors and rules for when an AI call may not run. Kept out of client.ts (which is server-only
// and needs the database) so the rules can be unit-tested directly.
import { providerLabel, type AiProvider } from "../shared/ai-providers";

export class AiValidationError extends Error {
  constructor(message: string, public raw?: string) {
    super(message);
  }
}
export class BudgetError extends Error {}
/** The user does not have enough literature-review credits to run this stage. */
export class InsufficientCreditsError extends Error {
  constructor(
    public required: number,
    public balance: number,
    public operation: string,
    public approxTokens: number,
    public articleCount: number,
  ) {
    super(
      `Not enough literature review credits: ${operation} requires ${required} credit${required === 1 ? "" : "s"} (~${approxTokens.toLocaleString("en-US")} tokens across ${articleCount} article${articleCount === 1 ? "" : "s"}), but you have ${balance}. Top up credits to continue.`,
    );
  }
}
/** The administrator switched AI off. Nothing was sent and nothing was spent; the work is kept. */
export class AiPausedError extends Error {
  constructor(message = "AI is paused by the administrator. Your work is saved.") {
    super(message);
  }
}
/** No AI API key is configured for the active provider. Handled like the AI switch: the job pauses and resumes once a key is added. */
export const NO_KEY_MESSAGE = "AI is not set up on this server yet: no xAI API key is configured. An administrator can add one in the dashboard. Your work is saved.";
export function noKeyMessage(provider: AiProvider = "xai") {
  const label = providerLabel(provider);
  return `AI is not set up on this server yet: no ${label} API key is configured. An administrator can add one in the dashboard. Your work is saved.`;
}
export class AiUnavailableError extends AiPausedError {
  constructor(provider: AiProvider = "xai") {
    super(noKeyMessage(provider));
  }
}
/** Errors that must stop a whole job (not just one batch): it pauses or fails cleanly and can be resumed. */
export const isAiStop = (e: unknown) => e instanceof BudgetError || e instanceof AiPausedError || e instanceof InsufficientCreditsError;

/**
 * Why an AI call must not be sent, checked before any network request: the ai_calls row to log (no cost) and
 * the error to throw, or null when the call may go ahead. The switch is checked first, then the key.
 */
export function aiRefusal(s: { enabled: boolean; key: string; provider?: AiProvider }): { row: { status: "paused"; error: string }; error: AiPausedError } | null {
  if (!s.enabled) return { row: { status: "paused", error: "AI switched off by an administrator" }, error: new AiPausedError() };
  if (!s.key) {
    const p = s.provider ?? "xai";
    return { row: { status: "paused", error: `no ${providerLabel(p)} API key configured` }, error: new AiUnavailableError(p) };
  }
  return null;
}
