import "server-only";
import { asc, eq, inArray } from "drizzle-orm";
import { db, schema } from "../db";
import { structuredCall } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { ScopingTopics, ScopingTurn } from "./ai-schemas";
import { getProject, HttpError, logDecision, markDownstreamStale, setStageState } from "../project";
import { newId, nowIso } from "../util";

export const MAX_SCOPING_QUESTIONS = 5;

function transcript(projectId: string) {
  const msgs = db.select().from(schema.scopingMessages).where(eq(schema.scopingMessages.projectId, projectId)).orderBy(asc(schema.scopingMessages.order)).all();
  return {
    msgs,
    text: msgs.length ? msgs.map((m) => `${m.role === "assistant" ? "Mentor" : "Researcher"}: ${m.text}`).join("\n") : "(no questions asked yet)",
    asked: msgs.filter((m) => m.role === "assistant" && (m.meta as { kind?: string } | null)?.kind === "question").length,
  };
}

export function scopingState(projectId: string) {
  const t = transcript(projectId);
  const last = [...t.msgs].reverse().find((m) => m.role === "assistant");
  const meta = (last?.meta ?? null) as { kind?: string; coverage?: Record<string, string | null>; draftTopics?: string[]; done?: boolean } | null;
  const topics = db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.sortOrder)).all();
  const p = getProject(projectId);
  return {
    messages: t.msgs,
    asked: t.asked,
    maxQuestions: MAX_SCOPING_QUESTIONS,
    coverage: meta?.coverage ?? null,
    draftTopics: meta?.draftTopics ?? [],
    done: !!meta?.done || t.asked >= MAX_SCOPING_QUESTIONS,
    awaitingAnswer: last?.role === "assistant" && meta?.kind === "question" && t.msgs[t.msgs.length - 1]?.id === last.id,
    topics,
    conceptMap: p.conceptMap,
    summary: p.scopingSummary,
  };
}

function addMessage(projectId: string, role: "user" | "assistant", text: string, meta: Record<string, unknown> | null = null) {
  const count = db.select().from(schema.scopingMessages).where(eq(schema.scopingMessages.projectId, projectId)).all().length;
  db.insert(schema.scopingMessages).values({ id: newId("msg"), projectId, role, text, order: count, meta }).run();
}

/** Ask the next scoping question (or finish if everything is covered / max questions reached). */
export async function nextScopingTurn(projectId: string) {
  const p = getProject(projectId);
  const t = transcript(projectId);
  if (t.asked >= MAX_SCOPING_QUESTIONS) {
    addMessage(projectId, "assistant", "Thanks — that's enough to build your search topics.", { kind: "done", done: true });
    return scopingState(projectId);
  }
  const { data } = await structuredCall({
    prompt: "scoping_turn",
    role: "fast",
    schema: ScopingTurn,
    projectId,
    stage: 2,
    vars: { idea: wrapData("research idea", p.idea), transcript: wrapData("conversation", t.text), asked: String(t.asked), maxQuestions: String(MAX_SCOPING_QUESTIONS) },
    mockInput: { idea: p.idea, asked: t.asked },
    check: (o) => (!o.done && !o.nextQuestion ? "nextQuestion is required when done=false" : null),
  });
  if (data.done || !data.nextQuestion) {
    addMessage(projectId, "assistant", "Thanks — I have what I need. Next I'll turn this into search topics you can edit.", { kind: "done", done: true, coverage: data.coverage, draftTopics: data.draftTopics });
  } else {
    addMessage(projectId, "assistant", data.nextQuestion, { kind: "question", target: data.questionTarget, coverage: data.coverage, draftTopics: data.draftTopics });
  }
  if (p.stageStates["2"] === "not_started") setStageState(projectId, 2, "needs_review");
  return scopingState(projectId);
}

export async function answerScoping(projectId: string, text: string) {
  const s = scopingState(projectId);
  if (!s.awaitingAnswer) throw new HttpError(409, "No question is waiting for an answer.");
  addMessage(projectId, "user", text.trim());
  logDecision(projectId, 2, "scoping_answer", null, { text });
  return nextScopingTurn(projectId);
}

/** Skip remaining questions. */
export function skipScoping(projectId: string) {
  addMessage(projectId, "assistant", "Okay — skipping the remaining questions.", { kind: "done", done: true });
  logDecision(projectId, 2, "scoping_skipped");
  return scopingState(projectId);
}

/** Generate the concept map and 4–8 topics from the conversation. Replaces existing AI topics. */
export async function generateTopics(projectId: string) {
  const p = getProject(projectId);
  const t = transcript(projectId);
  const { data } = await structuredCall({
    prompt: "scoping_topics",
    role: "fast",
    schema: ScopingTopics,
    projectId,
    stage: 2,
    vars: { idea: wrapData("research idea", p.idea), transcript: wrapData("conversation", t.text) },
    mockInput: { idea: p.idea },
    check: (o) => {
      const ids = new Set(o.conceptMap.nodes.map((n) => n.id));
      const bad = o.conceptMap.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
      return bad.length ? `conceptMap edges reference unknown node ids: ${bad.map((b) => `${b.from}->${b.to}`).join(", ")}` : null;
    },
  });
  const before = db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).all();
  db.transaction((tx) => {
    tx.delete(schema.topics).where(eq(schema.topics.projectId, projectId)).run();
    data.topics.forEach((tp, i) =>
      tx.insert(schema.topics).values({ id: newId("t"), projectId, name: tp.name, synonyms: tp.synonyms, controlledTerms: tp.controlledTerms, rationale: tp.rationale, sortOrder: i, origin: "ai" }).run(),
    );
    tx.update(schema.projects).set({ conceptMap: data.conceptMap, scopingSummary: data.summary, updatedAt: nowIso() }).where(eq(schema.projects.id, projectId)).run();
  });
  logDecision(projectId, 2, "topics_generated", before.map((b) => b.name), data.topics.map((x) => x.name), "ai");
  setStageState(projectId, 2, "needs_review");
  if (before.length) markDownstreamStale(projectId, 2, "Search topics were regenerated");
  return scopingState(projectId);
}

// ---- Topic editing (user checkpoint) ----

function touchTopics(projectId: string, why: string) {
  markDownstreamStale(projectId, 2, why);
}

export function addTopic(projectId: string, input: { name: string; synonyms?: string[]; controlledTerms?: string[]; rationale?: string }) {
  const n = db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).all().length;
  if (n >= 8) throw new HttpError(400, "A review can have at most 8 topics. Merge or delete one first.");
  const id = newId("t");
  db.insert(schema.topics).values({ id, projectId, name: input.name.trim(), synonyms: input.synonyms ?? [], controlledTerms: input.controlledTerms ?? [], rationale: input.rationale ?? "Added by you", origin: "user", sortOrder: n }).run();
  logDecision(projectId, 2, "topic_added", null, input);
  touchTopics(projectId, `Topic "${input.name}" was added`);
  return id;
}

export function updateTopic(projectId: string, topicId: string, patch: { name?: string; synonyms?: string[]; controlledTerms?: string[]; rationale?: string }) {
  const before = db.select().from(schema.topics).where(eq(schema.topics.id, topicId)).get();
  if (!before || before.projectId !== projectId) throw new HttpError(404, "Topic not found");
  const set: Partial<typeof schema.topics.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.synonyms) set.synonyms = patch.synonyms.map((s) => s.trim()).filter(Boolean);
  if (patch.controlledTerms) set.controlledTerms = patch.controlledTerms.map((s) => s.trim()).filter(Boolean);
  if (patch.rationale !== undefined) set.rationale = patch.rationale;
  db.update(schema.topics).set(set).where(eq(schema.topics.id, topicId)).run();
  logDecision(projectId, 2, "topic_edited", before, { ...before, ...set });
  touchTopics(projectId, `Topic "${before.name}" was edited`);
}

export function deleteTopic(projectId: string, topicId: string) {
  const before = db.select().from(schema.topics).where(eq(schema.topics.id, topicId)).get();
  if (!before || before.projectId !== projectId) throw new HttpError(404, "Topic not found");
  db.delete(schema.topics).where(eq(schema.topics.id, topicId)).run();
  logDecision(projectId, 2, "topic_deleted", before, null);
  touchTopics(projectId, `Topic "${before.name}" was deleted`);
}

export function mergeTopics(projectId: string, ids: string[], name: string) {
  if (ids.length < 2) throw new HttpError(400, "Pick at least two topics to merge.");
  const rows = db.select().from(schema.topics).where(inArray(schema.topics.id, ids)).all().filter((r) => r.projectId === projectId);
  if (rows.length !== ids.length) throw new HttpError(404, "Topic not found");
  const uniq = (a: string[]) => [...new Set(a.map((x) => x.trim()).filter(Boolean))];
  const id = newId("t");
  db.transaction((tx) => {
    tx.insert(schema.topics).values({
      id,
      projectId,
      name: name.trim() || rows.map((r) => r.name).join(" / "),
      synonyms: uniq(rows.flatMap((r) => [r.name, ...r.synonyms])).slice(0, 16),
      controlledTerms: uniq(rows.flatMap((r) => r.controlledTerms)),
      rationale: `Merged from: ${rows.map((r) => r.name).join("; ")}`,
      origin: "merged",
      sortOrder: Math.min(...rows.map((r) => r.sortOrder)),
    }).run();
    tx.delete(schema.topics).where(inArray(schema.topics.id, ids)).run();
  });
  logDecision(projectId, 2, "topics_merged", rows.map((r) => r.name), { name, id });
  touchTopics(projectId, `Topics merged into "${name}"`);
  return id;
}

export function approveTopics(projectId: string) {
  const rows = db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).all();
  if (rows.length < 1) throw new HttpError(400, "Add at least one topic before approving.");
  if (rows.length > 8) throw new HttpError(400, "Keep at most 8 topics.");
  db.update(schema.topics).set({ approved: true }).where(eq(schema.topics.projectId, projectId)).run();
}
