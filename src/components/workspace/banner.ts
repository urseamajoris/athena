// Which ONE state banner a screen shows under its headline, if any. Pure: unit-tested in banner.test.ts.
import { activeStage, stepStatus, type StepDef } from "@/lib/shared/flow";
import type { StageState } from "@/lib/shared/stages";
import { blockerOf, stepNeedsAi } from "../session/actions";

export type BannerState =
  /** A background job, or one long request, is running. */
  | { kind: "working"; title: string; done?: number; total?: number; stage?: number }
  /** The account has no credits left. */
  | { kind: "credits" }
  /** No API key on the server. */
  | { kind: "ai-not-set-up" }
  /** The administrator switched AI off. */
  | { kind: "ai-paused" }
  /** The server-wide AI budget is used up. */
  | { kind: "budget" }
  /** The last run, or the last button press, stopped with an error. `retry` says whether trying again can help. */
  | { kind: "failed"; message: string; stage?: number; fromAction?: boolean }
  /** An earlier answer changed after this was made. `blocker`: the screen to finish before it can be brought up to date. */
  | { kind: "stale"; reason: string; stage: number; blocker: StepDef | null };

export interface BannerInput {
  step: StepDef;
  states: Record<string, StageState | undefined>;
  staleReasons: Record<string, string>;
  jobs: Record<string, { status: string; error: string | null; progress: { done: number; total: number; message: string } } | null | undefined>;
  ai: { enabled: boolean; budgetReached: boolean; keyMissing: boolean };
  /** null = not known (then credits never block). */
  credits: { balance: number; exempt: boolean } | null;
  /** A long request being tracked (session.pending). */
  pending?: { label: string } | null;
  /** The message of the last failed command on this screen, with the server's error kind if it gave one. */
  actionError?: { message: string; kind?: string } | null;
}

const OUT_OF_CREDITS = /out of credits/i;
const NOT_SET_UP = /not set up|no .*api key/i;
const BUDGET = /budget/i;
const PAUSED = /paused by the administrator|switched off/i;

/** A message that says AI could not run is a paused state, not a failure: which one? */
export function stopKindOf(message: string | null | undefined, kind?: string): "credits" | "ai-not-set-up" | "ai-paused" | "budget" | null {
  const m = message ?? "";
  if (kind === "credits" || OUT_OF_CREDITS.test(m)) return "credits";
  if (NOT_SET_UP.test(m)) return "ai-not-set-up";
  if (kind === "budget" || BUDGET.test(m)) return "budget";
  if (kind === "ai_paused" || PAUSED.test(m)) return "ai-paused";
  return null;
}

/** AI cannot run for this account right now: why (credits first: that is the one the user can fix). */
function aiBlock(i: Pick<BannerInput, "ai" | "credits">): BannerState | null {
  if (i.credits && !i.credits.exempt && i.credits.balance <= 0) return { kind: "credits" };
  if (i.ai.keyMissing) return { kind: "ai-not-set-up" };
  if (!i.ai.enabled) return { kind: "ai-paused" };
  if (i.ai.budgetReached) return { kind: "budget" };
  return null;
}

export function pickBanner(i: BannerInput): BannerState | null {
  const status = stepStatus(i.step, i.states);
  // What the user just did comes first: it is the news.
  if (i.pending) return { kind: "working", title: `${i.pending.label}…` };
  if (i.actionError) {
    const stop = stopKindOf(i.actionError.message, i.actionError.kind);
    return stop ? { kind: stop } : { kind: "failed", message: i.actionError.message, fromAction: true };
  }
  if (status === "locked" || status === "done") return null;
  const stage = activeStage(i.step, i.states);
  const job = i.jobs[String(stage)];
  if (status === "working") {
    // A paused job keeps its stage "running": it waits for AI (a key, the switch, the budget) or for credits.
    if (job?.status === "paused") return { kind: stopKindOf(job.error) ?? aiBlock(i)?.kind ?? "ai-paused" } as BannerState;
    return { kind: "working", title: job?.progress.message || `Working on ${i.step.title.toLowerCase()}…`, done: job?.progress.done, total: job?.progress.total, stage };
  }
  if (status === "failed") {
    const failedStage = i.step.stages.find((n) => i.states[String(n)] === "failed") ?? stage;
    const message = i.jobs[String(failedStage)]?.error ?? "";
    const stop = stopKindOf(message);
    return stop ? { kind: stop } : { kind: "failed", message: message || "This step did not finish.", stage: failedStage };
  }
  if (status === "stale") {
    const staleStage = i.step.stages.find((n) => i.states[String(n)] === "stale") ?? stage;
    return { kind: "stale", reason: i.staleReasons[String(staleStage)] ?? "", stage: staleStage, blocker: blockerOf(i.step, i.states) };
  }
  // Ready or waiting for the user: say so now if the AI this screen needs cannot run.
  return stepNeedsAi(i.step, i.states) ? aiBlock(i) : null;
}
