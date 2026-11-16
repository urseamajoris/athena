// The review's process rules as pure functions (no database, no Node APIs), so they can be unit-tested directly
// (rules.test.ts). The API routes and jobs read the facts from the database and ask these what to do.
import { stageTitle, WORKING_QUESTION_GAP, WORKING_QUESTION_ORDER, type StageState } from "../shared/stages";

type States = Record<string, StageState | undefined>;
const stateOf = (states: States, n: number): StageState => states[String(n)] ?? "not_started";

// ---------- the working research question ----------

export interface WorkingQuestion {
  text: string;
  framework: string | null;
  structure: Record<string, string> | null;
}

/** The question a project works with, or null while none is set. */
export function workingQuestion(p: { question: string | null; questionFramework: string | null; questionStructure: Record<string, string> | null }): WorkingQuestion | null {
  const text = p.question?.trim();
  if (!text) return null;
  return { text, framework: p.questionFramework ?? null, structure: p.questionStructure && Object.keys(p.questionStructure).length ? p.questionStructure : null };
}

/** Trimmed text, a framework only when given, and a structure without empty parts (null when nothing is left). */
export function normalizeQuestion(input: { text: string; framework?: string | null; structure?: Record<string, string> | null }): WorkingQuestion {
  const parts = Object.entries(input.structure ?? {})
    .map(([k, v]) => [k.trim(), v.trim()] as const)
    .filter(([k, v]) => k && v);
  return { text: input.text.trim().replace(/\s+/g, " "), framework: input.framework?.trim() || null, structure: parts.length ? Object.fromEntries(parts) : null };
}

export function sameQuestion(a: WorkingQuestion | null, b: WorkingQuestion | null): boolean {
  if (!a || !b) return a === b;
  const parts = (q: WorkingQuestion) => JSON.stringify(Object.entries(q.structure ?? {}).sort(([x], [y]) => x.localeCompare(y)));
  return a.text === b.text && (a.framework ?? null) === (b.framework ?? null) && parts(a) === parts(b);
}

/**
 * The question as plain text for a prompt or a report: the sentence, then its framework parts one per line.
 * With no question set (a review started before questions were confirmed up front) it says so, and prompts then
 * fall back on the research idea.
 */
export function questionText(q: WorkingQuestion | null): string {
  if (!q) return "(no research question has been set; use the research idea instead)";
  const lines = [q.text];
  if (q.framework) lines.push(`Framework: ${q.framework}`);
  for (const [k, v] of Object.entries(q.structure ?? {})) lines.push(`- ${k}: ${v}`);
  return lines.join("\n");
}

// ---------- the project title ----------

const TITLE_MAX = 90;
export const clipTitle = (s: string) => s.trim().slice(0, TITLE_MAX);

/**
 * The title follows its source (the idea, then the confirmed research question) until the user renames the
 * project: when the title is still the clipped old source it becomes the clipped new one, otherwise it is kept.
 */
export function retitle(title: string, oldSource: string | null | undefined, newSource: string): string {
  if (!title.trim()) return clipTitle(newSource);
  if (oldSource && title === clipTitle(oldSource)) return clipTitle(newSource);
  return title;
}

// ---------- stage gating ----------

/** The first stage before `n` that is not confirmed, as a message for the user, or null when `n` is open. */
export function upstreamBlock(states: States, n: number): string | null {
  for (let i = 1; i < n; i++) if (stateOf(states, i) !== "approved") return `Finish “${stageTitle(i)}” first.`;
  return null;
}

/** Topics that have no database search yet. The search plan cannot be confirmed while any topic is listed here. */
export function topicsWithoutQueries<T extends { id: string }>(topics: T[], queries: { topicId: string }[]): T[] {
  const has = new Set(queries.map((q) => q.topicId));
  return topics.filter((t) => !has.has(t.id));
}

export const MAX_TOPICS = 8;

export interface ApprovalFacts {
  idea: string;
  question: string | null;
  topics: { id: string; name: string }[];
  queries: { topicId: string }[];
  /** A final question is picked (stage 9). */
  questionChosen: boolean;
}

/**
 * Why a stage cannot be confirmed yet, or null when it can: a plain message, shown as it is, and the HTTP status
 * (400: something is missing that the user must supply; 409: the stage is not ready).
 * `hasJob`: the stage's work runs as a background job, which must have finished at least once.
 */
export function approvalBlock(n: number, state: StageState, facts: ApprovalFacts, hasJob: boolean): { status: 400 | 409; message: string } | null {
  const missing = (message: string) => ({ status: 400 as const, message });
  if (state === "running") return { status: 409, message: "This step is still running. Wait for it to finish." };
  if (n === 1 && !facts.idea.trim()) return missing("Write your idea first.");
  if (n === 2 && !facts.question?.trim()) return missing("Choose or write your research question first.");
  if (n === 3) {
    if (!facts.topics.length) return missing("Add at least one search topic first.");
    if (facts.topics.length > MAX_TOPICS) return missing(`Keep at most ${MAX_TOPICS} search topics. Merge or delete some first.`);
    const none = topicsWithoutQueries(facts.topics, facts.queries);
    if (none.length === 1) return missing(`The topic “${none[0].name}” has no searches yet. Write its searches or delete the topic, then continue.`);
    if (none.length) return missing(`These topics have no searches yet: ${none.map((t) => `“${t.name}”`).join(", ")}. Write their searches or delete the topics, then continue.`);
  }
  if (hasJob && (state === "not_started" || state === "failed")) return { status: 409, message: "This step has not finished yet. Run it first." };
  if (n === 9 && !facts.questionChosen) return missing("Pick your final question first.");
  return null;
}

// ---------- summaries (5) and ranking (6): one checkpoint ----------

/**
 * Paper summaries (stage 5) have no checkpoint of their own: the user reviews summaries and ranking together at
 * stage 6. So whenever stage 5 is waiting for review and everything before it is confirmed, it is confirmed by
 * the system, and ranking follows:
 *   - `jobFinished` (a summaries job has just ended successfully): ranking starts, unless it is already running;
 *   - otherwise (a stale stage 5 was kept, an interrupted chain is picked up): ranking starts only if it never ran.
 * A failed, paused or cancelled summaries job leaves stage 5 failed or running, so nothing here applies to it.
 */
export function summariesStep(states: States, opts: { jobFinished: boolean }): { approve: boolean; rank: boolean } {
  if (stateOf(states, 5) !== "needs_review" || upstreamBlock(states, 5)) return { approve: false, rank: false };
  const six = stateOf(states, 6);
  return { approve: true, rank: opts.jobFinished ? six !== "running" : six === "not_started" };
}

/** Stages a "keep the current results" choice applies to: 5 and 6 are one checkpoint, so they are kept together. */
export function keepTogether(n: number): number[] {
  return n === 5 || n === 6 ? [5, 6] : [n];
}

// ---------- the final question (stage 9) ----------

/**
 * The working research question as the first candidate of stage 9 ("Your question, unchanged"). It is made
 * without a model call; `isWorkingQuestionCandidate` (shared/stages.ts) recognises it by its order and gap text.
 */
export function workingQuestionCandidate(q: WorkingQuestion) {
  return {
    text: q.text,
    framework: q.framework ?? "other",
    structure: q.structure ?? {},
    design: "",
    gap: WORKING_QUESTION_GAP,
    feasibility: "",
    weakness: "",
    order: WORKING_QUESTION_ORDER,
  };
}
