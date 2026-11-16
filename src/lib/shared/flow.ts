// Shared between server and client (no Node APIs here).
//
// What the user sees is FOUR stages with eight screens ("steps"). Underneath, the engine still has nine numbered
// stages (src/lib/shared/stages.ts): their numbers are stored in projects, jobs, ai_calls and the decision log, so
// they do not change. This file is the one place that maps between the two.
//
//   1 Idea       idea        (engine stage 1)
//   2 Question   question    (2)  a short chat, then a research question the user confirms
//   3 Papers     search      (3)  search topics and database searches, written from the question
//                found       (4)  the searches run; what came back
//                choose      (5+6) every paper summarised and ranked against the question; pick which to analyse
//   4 Analysis   articles    (7)  each chosen article analysed, with quotes checked against its text
//                evidence    (8)  what the articles say together
//                report      (9)  the question revised in light of the evidence, and the downloads
import type { StageState } from "./stages";

export type PhaseKey = "idea" | "question" | "papers" | "analysis";
export type StepKey = "idea" | "question" | "search" | "found" | "choose" | "articles" | "evidence" | "report";

export interface StepDef {
  key: StepKey;
  phase: PhaseKey;
  /** Engine stages this screen covers, in order. `choose` covers two: summaries (5) then ranking (6). */
  stages: number[];
  /** Short name for the stage rail. */
  title: string;
  /** The task, as the page headline. */
  headline: string;
  /** One sentence: what to do here. */
  lead: string;
}

export interface PhaseDef {
  key: PhaseKey;
  n: number;
  title: string;
  /** One line under the stage name. */
  blurb: string;
}

export const PHASES: PhaseDef[] = [
  { key: "idea", n: 1, title: "Idea", blurb: "Say what you want to research" },
  { key: "question", n: 2, title: "Question", blurb: "Turn it into a research question" },
  { key: "papers", n: 3, title: "Papers", blurb: "Find and choose real papers" },
  { key: "analysis", n: 4, title: "Analysis", blurb: "Read each article, then conclude" },
];

export const STEPS: StepDef[] = [
  { key: "idea", phase: "idea", stages: [1], title: "Your idea", headline: "What do you want to research?", lead: "Write it roughly, in your own words. A sentence is enough." },
  { key: "question", phase: "question", stages: [2], title: "Research question", headline: "Refine your idea into a research question", lead: "Answer a few short questions, then choose and edit the question you will work with." },
  { key: "search", phase: "papers", stages: [3], title: "Search plan", headline: "Check the search plan", lead: "These topics and database searches come from your question. Edit anything, then run them." },
  { key: "found", phase: "papers", stages: [4], title: "Papers found", headline: "See what the searches found", lead: "Real records from PubMed and OpenAlex, with duplicates removed." },
  { key: "choose", phase: "papers", stages: [5, 6], title: "Choose papers", headline: "Choose the papers to analyse", lead: "Each paper is summarised and ranked against your question. Keep the ones worth reading closely." },
  { key: "articles", phase: "analysis", stages: [7], title: "Article analysis", headline: "Check the analysis of each article", lead: "One article at a time: what it found, how it was done, and how it bears on your question." },
  { key: "evidence", phase: "analysis", stages: [8], title: "Evidence summary", headline: "Read what the articles say together", lead: "What is known, what is contested and what is still unknown, with the findings behind each statement." },
  { key: "report", phase: "analysis", stages: [9], title: "Final question & report", headline: "Settle your question and download the report", lead: "Keep your question or take a revision the evidence suggests, then download your review." },
];

export const STEP_BY_KEY = Object.fromEntries(STEPS.map((s) => [s.key, s])) as Record<StepKey, StepDef>;

export function isStepKey(v: unknown): v is StepKey {
  return typeof v === "string" && v in STEP_BY_KEY;
}

/** The screen that holds an engine stage (1–9). */
export function stepForStage(stage: number): StepDef {
  return STEPS.find((s) => s.stages.includes(stage)) ?? STEPS[0];
}

export function phaseOf(step: StepKey): PhaseDef {
  return PHASES.find((p) => p.key === STEP_BY_KEY[step].phase)!;
}

export function stepsOfPhase(phase: PhaseKey): StepDef[] {
  return STEPS.filter((s) => s.phase === phase);
}

/**
 * What a screen is doing, from the engine stages it covers:
 *   locked   an earlier screen is not finished, so this one cannot start
 *   todo     ready, nothing done yet
 *   working  a background job is running
 *   review   waiting for the user (to check, edit or confirm)
 *   stale    an earlier answer changed after this was made
 *   failed   the last run stopped with an error
 *   done     confirmed
 */
export type StepStatus = "locked" | "todo" | "working" | "review" | "stale" | "failed" | "done";

export const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  locked: "Locked",
  todo: "Not started",
  working: "Working",
  review: "Your turn",
  stale: "Out of date",
  failed: "Stopped",
  done: "Done",
};

type States = Record<string, StageState | undefined>;
const stateOf = (states: States, n: number): StageState => states[String(n)] ?? "not_started";

export function stepStatus(step: StepDef, states: States): StepStatus {
  const own = step.stages.map((n) => stateOf(states, n));
  if (own.every((s) => s === "approved")) return "done";
  if (own.includes("running")) return "working";
  if (own.includes("failed")) return "failed";
  if (own.includes("stale")) return "stale";
  if (own.some((s) => s === "needs_review" || s === "approved")) return "review";
  // Nothing started here: open only when everything before it is confirmed.
  const first = step.stages[0];
  for (let n = 1; n < first; n++) if (stateOf(states, n) !== "approved") return "locked";
  return "todo";
}

/** The screen the user should be on: the first one that is not done (the last one when everything is). */
export function currentStep(states: States): StepDef {
  return STEPS.find((s) => stepStatus(s, states) !== "done") ?? STEPS[STEPS.length - 1];
}

/** The engine stage inside a screen that needs attention first (for `choose`: 5 until it is approved, then 6). */
export function activeStage(step: StepDef, states: States): number {
  return step.stages.find((n) => stateOf(states, n) !== "approved") ?? step.stages[step.stages.length - 1];
}

/** "Stage 3 of 4 · Papers" */
export function phaseLabel(step: StepKey): string {
  const p = phaseOf(step);
  return `Stage ${p.n} of ${PHASES.length} · ${p.title}`;
}

/** How many of the eight screens are done, for progress bars. */
export function progress(states: States): { done: number; total: number } {
  return { done: STEPS.filter((s) => stepStatus(s, states) === "done").length, total: STEPS.length };
}
