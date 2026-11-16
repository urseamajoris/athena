import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema } from "../db";
import type { QuestionDraft } from "../db/schema";
import { structuredCall } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { pairsToRecord, QuestionDrafts, ScopingTurn } from "./ai-schemas";
import { getProject, HttpError, logDecision, markDownstreamStale, setStageState } from "../project";
import { newId, nowIso } from "../util";
import { normalizeQuestion, retitle, sameQuestion, workingQuestion, type WorkingQuestion } from "./rules";
import type { PromptVars } from "./prompt-vars";

/*
 * Stage 2, the research question: a short chat that pins down what the idea leaves open (at most five questions,
 * skippable), three AI-drafted wordings of one research question, and the working question the user confirms.
 */

export const MAX_SCOPING_QUESTIONS = 5;

/** The scoping chat as text for a prompt. Later stages read it too (the search plan is written from it). */
export async function transcript(projectId: string) {
  const msgs = (await db.select().from(schema.scopingMessages).where(eq(schema.scopingMessages.projectId, projectId)).orderBy(asc(schema.scopingMessages.order)).all());
  return {
    msgs,
    text: msgs.length ? msgs.map((m) => `${m.role === "assistant" ? "Mentor" : "Researcher"}: ${m.text}`).join("\n") : "(no questions asked yet)",
    asked: msgs.filter((m) => m.role === "assistant" && (m.meta as { kind?: string } | null)?.kind === "question").length,
  };
}

type TurnMeta = { kind?: string; target?: string | null; coverage?: Record<string, string | null>; done?: boolean } | null;

/** The latest assistant turn that carried a coverage summary. "Skip the rest" and the closing turn carry none of their own. */
function lastCoverage(msgs: { role: string; meta: unknown }[]) {
  const m = [...msgs].reverse().find((x) => x.role === "assistant" && (x.meta as TurnMeta)?.coverage);
  return (m?.meta ?? null) as TurnMeta;
}

export async function scopingState(projectId: string) {
  const t = (await transcript(projectId));
  const last = [...t.msgs].reverse().find((m) => m.role === "assistant");
  const meta = (last?.meta ?? null) as TurnMeta;
  const known = lastCoverage(t.msgs);
  const p = (await getProject(projectId));
  return {
    messages: t.msgs,
    asked: t.asked,
    maxQuestions: MAX_SCOPING_QUESTIONS,
    /** What is known so far, per element (population, phenomenon, comparison, outcome, setting, timeframe, studyTypes). */
    coverage: known?.coverage ?? null,
    done: !!meta?.done || t.asked >= MAX_SCOPING_QUESTIONS,
    awaitingAnswer: last?.role === "assistant" && meta?.kind === "question" && t.msgs[t.msgs.length - 1]?.id === last.id,
    /** The working research question (null until one is saved), its framework parts and the AI's latest drafts. */
    question: p.question,
    questionFramework: p.questionFramework,
    questionStructure: p.questionStructure,
    questionDrafts: p.questionDrafts ?? [],
    questionConfirmedAt: p.questionConfirmedAt,
  };
}

async function addMessage(projectId: string, role: "user" | "assistant", text: string, meta: Record<string, unknown> | null = null) {
  const count = (await db.select().from(schema.scopingMessages).where(eq(schema.scopingMessages.projectId, projectId)).all()).length;
  (await db.insert(schema.scopingMessages).values({ id: newId("msg"), projectId, role, text, order: count, meta }).run());
}

/** Ask the next question (or finish when enough is known to write a research question, or the maximum is reached). */
export async function nextScopingTurn(projectId: string) {
  const p = (await getProject(projectId));
  const t = (await transcript(projectId));
  if (t.asked >= MAX_SCOPING_QUESTIONS) {
    // No model call for the closing turn, so file the last answer under the field its question asked about.
    const known = lastCoverage(t.msgs);
    const lastQ = [...t.msgs].reverse().find((m) => m.role === "assistant" && (m.meta as TurnMeta)?.kind === "question");
    const target = (lastQ?.meta as TurnMeta)?.target;
    const lastAnswer = t.msgs[t.msgs.length - 1]?.role === "user" ? t.msgs[t.msgs.length - 1].text : null;
    const coverage = { ...(known?.coverage ?? {}) };
    if (target && lastAnswer && !coverage[target]) coverage[target] = lastAnswer;
    (await addMessage(projectId, "assistant", "Thanks. That is enough to draft your research question.", { kind: "done", done: true, coverage }));
    return (await scopingState(projectId));
  }
  const { data } = await structuredCall({
    prompt: "scoping_turn",
    role: "fast",
    schema: ScopingTurn,
    projectId,
    stage: 2,
    vars: { idea: wrapData("research idea", p.idea), transcript: wrapData("conversation", t.text), asked: String(t.asked), maxQuestions: String(MAX_SCOPING_QUESTIONS) } satisfies PromptVars<"scoping_turn">,
    check: (o) => (!o.done && !o.nextQuestion ? "nextQuestion is required when done=false" : null),
  });
  if (data.done || !data.nextQuestion) {
    (await addMessage(projectId, "assistant", "Thanks. I have what I need to draft your research question.", { kind: "done", done: true, coverage: data.coverage }));
  } else {
    (await addMessage(projectId, "assistant", data.nextQuestion, { kind: "question", target: data.questionTarget, coverage: data.coverage }));
  }
  if (p.stageStates["2"] === "not_started") (await setStageState(projectId, 2, "needs_review"));
  return (await scopingState(projectId));
}

export async function answerScoping(projectId: string, text: string) {
  const s = (await scopingState(projectId));
  if (!s.awaitingAnswer) throw new HttpError(409, "No question is waiting for an answer.");
  (await addMessage(projectId, "user", text.trim()));
  (await logDecision(projectId, 2, "scoping_answer", null, { text }));
  return (await nextScopingTurn(projectId));
}

/** Skip remaining questions. */
export async function skipScoping(projectId: string) {
  (await addMessage(projectId, "assistant", "Okay. Skipping the remaining questions.", { kind: "done", done: true }));
  (await logDecision(projectId, 2, "scoping_skipped"));
  if ((await getProject(projectId)).stageStates["2"] === "not_started") (await setStageState(projectId, 2, "needs_review"));
  return (await scopingState(projectId));
}

/**
 * Draft three wordings of one research question from the idea and whatever the chat has covered (nothing, when
 * it was skipped). They replace earlier drafts. Drafting never changes the working question: the user picks.
 */
export async function draftQuestions(projectId: string) {
  const p = (await getProject(projectId));
  const t = (await transcript(projectId));
  const { data } = await structuredCall({
    prompt: "question_draft",
    role: "fast",
    schema: QuestionDrafts,
    projectId,
    stage: 2,
    vars: { idea: wrapData("research idea", p.idea), transcript: wrapData("conversation", t.text) } satisfies PromptVars<"question_draft">,
    check: (o) => {
      const noMark = o.drafts.filter((d) => !d.text.endsWith("?"));
      if (noMark.length) return `Every draft must be one question ending with a question mark. Fix: ${noMark.map((d) => `"${d.text}"`).join("; ")}`;
      const texts = new Set(o.drafts.map((d) => d.text.toLowerCase()));
      return texts.size < o.drafts.length ? "The three drafts must be three different wordings." : null;
    },
  });
  const drafts: QuestionDraft[] = data.drafts.map((d) => ({ text: d.text, framework: d.framework, structure: pairsToRecord(d.structure), note: d.note }));
  (await db.update(schema.projects).set({ questionDrafts: drafts, updatedAt: nowIso() }).where(eq(schema.projects.id, projectId)).run());
  (await logDecision(projectId, 2, "question_drafted", p.questionDrafts?.map((d) => d.text) ?? null, drafts.map((d) => d.text), "ai"));
  if (p.stageStates["2"] === "not_started") (await setStageState(projectId, 2, "needs_review"));
  return (await scopingState(projectId));
}

/**
 * Save the working research question: one of the drafts, an edit of one, or the user's own words. A changed
 * question is no longer confirmed, and everything made from the earlier one (the search plan onwards) goes stale.
 */
export async function setQuestion(projectId: string, input: { text: string; framework?: string | null; structure?: Record<string, string> | null }) {
  const p = (await getProject(projectId));
  const before = workingQuestion(p);
  const next: WorkingQuestion = normalizeQuestion(input);
  if (sameQuestion(before, next)) return (await scopingState(projectId));
  (await db.update(schema.projects)
        .set({
          question: next.text,
          questionFramework: next.framework,
          questionStructure: next.structure,
          questionConfirmedAt: null,
          // A title that was the earlier question follows the new wording; a title the user chose is kept.
          title: before ? retitle(p.title, before.text, next.text) : p.title,
          updatedAt: nowIso(),
        })
        .where(eq(schema.projects.id, projectId))
        .run());
  (await logDecision(projectId, 2, before ? "question_edited" : "question_set", before, next));
  if (p.stageStates["2"] === "not_started") (await setStageState(projectId, 2, "needs_review"));
  (await markDownstreamStale(projectId, 2, "The research question was edited"));
  return (await scopingState(projectId));
}

/** Confirming stage 2: the question is stamped as confirmed and names the review from here on. */
export async function confirmQuestion(projectId: string) {
  const p = (await getProject(projectId));
  const q = workingQuestion(p);
  if (!q) throw new HttpError(400, "Choose or write your research question first.");
  (await db.update(schema.projects).set({ questionConfirmedAt: nowIso(), title: retitle(p.title, p.idea, q.text), updatedAt: nowIso() }).where(eq(schema.projects.id, projectId)).run());
  (await logDecision(projectId, 2, "question_confirmed", null, q));
}
