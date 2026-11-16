// What the session can be asked to do (commands), and the one next action for the engine stage that needs the
// user. Pure: no React, no fetch. Unit-tested in actions.test.ts.
//
// The labels follow the button rule (docs/ux-intent.md): verb first, the object, and the count where there is
// one. Each action also carries its "what happens next" line for the action bar.
import { STAGES, type StageState } from "@/lib/shared/stages";
import { STEPS, STEP_BY_KEY, currentStep, stepForStage, stepStatus, type StepDef, type StepKey } from "@/lib/shared/flow";

export type States = Record<string, StageState | undefined>;

export type Cmd =
  /** Confirm an engine stage (the checkpoint at the end of a screen). The next stage's job starts by itself. */
  | { type: "approve"; stage: number }
  /** Start, or start again, the background job of a stage. */
  | { type: "run"; stage: number }
  /** Out-of-date results: keep them and check them again, without re-running. */
  | { type: "keep"; stage: number }
  /** Out-of-date results: make them again from the current answers. */
  | { type: "bringUpToDate"; stage: number }
  /** Open a confirmed stage for changes. */
  | { type: "reopen"; stage: number }
  /** Stop a running job. */
  | { type: "cancel"; stage: number }
  /** Write the search topics and the database searches from the research question (one long AI request). */
  | { type: "buildSearch" }
  | { type: "goToStep"; step: StepKey }
  | { type: "download" };

export interface Action {
  cmd: Cmd;
  /** What the button says. */
  label: string;
  /** Why it cannot be pressed yet, in words shown next to it. Undefined = it can. */
  disabledReason?: string;
  /** One short line for the action bar: what pressing it leads to, and whether it uses credits. */
  next?: string;
}

/** The counts an action label needs. Every field is optional: the server's summary may not have it (yet). */
export interface ActionFacts {
  idea?: string;
  /** The working research question, once there is one. */
  question?: string | null;
  searches?: number;
  papersFound?: number;
  papersChosen?: number;
  /** The final question has been picked on the report screen. */
  finalQuestionChosen?: boolean;
}

export const cmdKey = (c: Cmd) => JSON.stringify(c);
const st = (states: States, n: number): StageState => states[String(n)] ?? "not_started";
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The first engine stage that is not confirmed, or null when the whole review is. */
export function frontierStage(states: States): number | null {
  return STAGES.find((s) => st(states, s.n) !== "approved")?.n ?? null;
}

/** The earlier screen that must be finished before `step` can move, or null. */
export function blockerOf(step: StepDef, states: States): StepDef | null {
  const cur = currentStep(states);
  return STEPS.indexOf(cur) < STEPS.indexOf(step) ? cur : null;
}

/** "Finish Research question first": what a locked screen says. */
export function unlockText(step: StepDef, states: States): string | null {
  const b = blockerOf(step, states);
  return b ? `Finish ${b.title} first` : null;
}

/** Which engine stages use AI when they run (so credits, and the AI being available, matter). */
export const AI_STAGES = new Set([2, 3, 5, 6, 7, 8, 9]);
/** Does this screen still have AI work ahead of it? */
export function stepNeedsAi(step: StepDef, states: States): boolean {
  return step.stages.some((n) => AI_STAGES.has(n) && st(states, n) !== "approved");
}

const USES_CREDITS = "Uses credits.";
const FREE = "No credits used.";

/**
 * The one next action for an engine stage, or null when there is nothing to press (it is running, or it is out of
 * date or stopped, which the screen's banner handles with its own buttons).
 */
export function stageAction(stage: number | null, states: States, facts: ActionFacts = {}): Action | null {
  if (stage === null) return { cmd: { type: "download" }, label: "Download report", next: "Your review is finished. You can still open any screen to read it." };
  const state = st(states, stage);
  if (state === "running" || state === "stale") return null;
  const def = STAGES[stage - 1];
  if (def.job && state === "failed") return null;
  if (def.job && state === "not_started") return { cmd: { type: "run", stage }, label: `Start ${def.title.toLowerCase()}`, next: AI_STAGES.has(stage) ? USES_CREDITS : FREE };
  switch (stage) {
    case 1:
      return { cmd: { type: "approve", stage: 1 }, label: "Continue with this idea", disabledReason: (facts.idea ?? "").trim().length < 10 ? "Write at least a sentence about your idea." : undefined, next: `Next: a few short questions turn your idea into a research question. ${USES_CREDITS}` };
    case 2:
      return { cmd: { type: "approve", stage: 2 }, label: "Confirm this question", disabledReason: facts.question === undefined || (facts.question ?? "").trim() ? undefined : "Choose or write your research question first.", next: "Next: Athena plans the searches from your question. You check them before they run." };
    case 3:
      if (!facts.searches) return { cmd: { type: "buildSearch" }, label: "Build my search plan", next: `Athena writes search topics and one search per database. You can edit everything. ${USES_CREDITS}` };
      return { cmd: { type: "approve", stage: 3 }, label: `Run ${plural(facts.searches, "search", "searches")}`, next: `Next: Athena searches PubMed and OpenAlex. ${FREE}` };
    case 4:
      return { cmd: { type: "approve", stage: 4 }, label: facts.papersFound ? `Summarise ${plural(facts.papersFound, "paper")}` : "Summarise the papers", next: `Next: each paper is summarised and ranked against your question. ${USES_CREDITS}` };
    case 5:
      return { cmd: { type: "approve", stage: 5 }, label: "Rank the papers", next: `Next: the papers are ranked against your question. ${USES_CREDITS}` };
    case 6:
      return { cmd: { type: "approve", stage: 6 }, label: facts.papersChosen ? `Analyse ${plural(facts.papersChosen, "article")}` : "Analyse the chosen articles", disabledReason: facts.papersChosen === 0 ? "Choose at least one paper first." : undefined, next: `Next: each chosen article is read and analysed, with quotes checked against its text. ${USES_CREDITS}` };
    case 7:
      return { cmd: { type: "approve", stage: 7 }, label: "Summarise the evidence", next: `Next: what the articles say together: known, contested and unknown. ${USES_CREDITS}` };
    case 8:
      return { cmd: { type: "approve", stage: 8 }, label: "Check my question against the evidence", next: `Next: your question, plus revisions the evidence suggests. ${USES_CREDITS}` };
    case 9:
      return { cmd: { type: "approve", stage: 9 }, label: "Finish my review", disabledReason: facts.finalQuestionChosen === false ? "Keep your question or pick a revision first." : undefined, next: `Next: download your report. ${FREE}` };
    default:
      return null;
  }
}

/** The next action for a screen: its active stage's action while the screen is the one that needs the user. */
export function stepAction(step: StepKey, states: States, facts: ActionFacts = {}): Action | null {
  const def = STEP_BY_KEY[step];
  const f = frontierStage(states);
  if (f === null) return def.key === "report" ? stageAction(null, states, facts) : null;
  return def.stages.includes(f) ? stageAction(f, states, facts) : null;
}

/** What "Bring up to date" does for an out-of-date stage: re-run its job, rebuild the search plan, or (where
 *  nothing can be re-made automatically) keep the results and check them again. */
export function upToDateCmd(stage: number): Cmd {
  if (STAGES[stage - 1]?.job) return { type: "run", stage };
  if (stage === 3) return { type: "buildSearch" };
  return { type: "keep", stage };
}

/** The screens after an engine stage that already hold work (they go out of date when that stage is edited). */
export function downstreamSteps(stage: number, states: States): StepDef[] {
  const own = stepForStage(stage);
  return STEPS.filter((s) => STEPS.indexOf(s) > STEPS.indexOf(own) && !["locked", "todo"].includes(stepStatus(s, states)));
}
