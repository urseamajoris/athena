import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema, batchWrite, type BatchItem } from "../db";
import { structuredCall } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { ScopingTopics, ScopingTurn } from "./ai-schemas";
import { getProject, HttpError, logDecision, markDownstreamStale, setStageState } from "../project";
import { newId, nowIso, forEachSeq } from "../util";

export const MAX_SCOPING_QUESTIONS = 5;

async function transcript(projectId: string) {
  const msgs = (await db.select().from(schema.scopingMessages).where(eq(schema.scopingMessages.projectId, projectId)).orderBy(asc(schema.scopingMessages.order)).all());
  return {
    msgs,
    text: msgs.length ? msgs.map((m) => `${m.role === "assistant" ? "Mentor" : "Researcher"}: ${m.text}`).join("\n") : "(no questions asked yet)",
    asked: msgs.filter((m) => m.role === "assistant" && (m.meta as { kind?: string } | null)?.kind === "question").length,
  };
}

type TurnMeta = { kind?: string; target?: string | null; coverage?: Record<string, string | null>; draftTopics?: string[]; done?: boolean } | null;

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
  const topics = (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.sortOrder)).all());
  const p = (await getProject(projectId));
  return {
    messages: t.msgs,
    asked: t.asked,
    maxQuestions: MAX_SCOPING_QUESTIONS,
    coverage: known?.coverage ?? null,
    draftTopics: known?.draftTopics ?? [],
    done: !!meta?.done || t.asked >= MAX_SCOPING_QUESTIONS,
    awaitingAnswer: last?.role === "assistant" && meta?.kind === "question" && t.msgs[t.msgs.length - 1]?.id === last.id,
    topics,
    conceptMap: p.conceptMap,
    summary: p.scopingSummary,
  };
}

async function addMessage(projectId: string, role: "user" | "assistant", text: string, meta: Record<string, unknown> | null = null) {
  const count = (await db.select().from(schema.scopingMessages).where(eq(schema.scopingMessages.projectId, projectId)).all()).length;
  (await db.insert(schema.scopingMessages).values({ id: newId("msg"), projectId, role, text, order: count, meta }).run());
}

/** Ask the next scoping question (or finish if everything is covered / max questions reached). */
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
    (await addMessage(projectId, "assistant", "Thanks — that's enough to build your search topics.", { kind: "done", done: true, coverage, draftTopics: known?.draftTopics ?? [] }));
    return (await scopingState(projectId));
  }
  const { data } = await structuredCall({
    prompt: "scoping_turn",
    role: "fast",
    schema: ScopingTurn,
    projectId,
    stage: 2,
    vars: { idea: wrapData("research idea", p.idea), transcript: wrapData("conversation", t.text), asked: String(t.asked), maxQuestions: String(MAX_SCOPING_QUESTIONS) },
    check: (o) => (!o.done && !o.nextQuestion ? "nextQuestion is required when done=false" : null),
  });
  if (data.done || !data.nextQuestion) {
    (await addMessage(projectId, "assistant", "Thanks — I have what I need. Next I'll turn this into search topics you can edit.", { kind: "done", done: true, coverage: data.coverage, draftTopics: data.draftTopics }));
  } else {
    (await addMessage(projectId, "assistant", data.nextQuestion, { kind: "question", target: data.questionTarget, coverage: data.coverage, draftTopics: data.draftTopics }));
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
  (await addMessage(projectId, "assistant", "Okay — skipping the remaining questions.", { kind: "done", done: true }));
  (await logDecision(projectId, 2, "scoping_skipped"));
  return (await scopingState(projectId));
}

/** Generate the concept map and 4–8 topics from the conversation. Replaces existing AI topics. */
export async function generateTopics(projectId: string) {
  const p = (await getProject(projectId));
  const t = (await transcript(projectId));
  const { data } = await structuredCall({
    prompt: "scoping_topics",
    role: "fast",
    schema: ScopingTopics,
    projectId,
    stage: 2,
    vars: { idea: wrapData("research idea", p.idea), transcript: wrapData("conversation", t.text) },
    check: (o) => {
      const ids = new Set(o.conceptMap.nodes.map((n) => n.id));
      const bad = o.conceptMap.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
      return bad.length ? `conceptMap edges reference unknown node ids: ${bad.map((b) => `${b.from}->${b.to}`).join(", ")}` : null;
    },
  });
  const before = (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).all());
  {
    const stmts: BatchItem<"sqlite">[] = [];
        stmts.push(db.delete(schema.topics).where(eq(schema.topics.projectId, projectId)));
        await forEachSeq(data.topics, async (tp, i) =>
          stmts.push(db.insert(schema.topics).values({ id: newId("t"), projectId, name: tp.name, synonyms: tp.synonyms, controlledTerms: tp.controlledTerms, rationale: tp.rationale, sortOrder: i, origin: "ai" })),
        );
        stmts.push(db.update(schema.projects).set({ conceptMap: data.conceptMap, scopingSummary: data.summary, updatedAt: nowIso() }).where(eq(schema.projects.id, projectId)));
        await batchWrite(stmts);
  }
  (await logDecision(projectId, 2, "topics_generated", before.map((b) => b.name), data.topics.map((x) => x.name), "ai"));
  (await setStageState(projectId, 2, "needs_review"));
  if (before.length) (await markDownstreamStale(projectId, 2, "Search topics were regenerated"));
  return (await scopingState(projectId));
}

// ---- Topic editing (user checkpoint) ----

async function touchTopics(projectId: string, why: string) {
  (await markDownstreamStale(projectId, 2, why));
}

export async function addTopic(projectId: string, input: { name: string; synonyms?: string[]; controlledTerms?: string[]; rationale?: string }) {
  const n = (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).all()).length;
  if (n >= 8) throw new HttpError(400, "A review can have at most 8 topics. Merge or delete one first.");
  const id = newId("t");
  (await db.insert(schema.topics).values({ id, projectId, name: input.name.trim(), synonyms: input.synonyms ?? [], controlledTerms: input.controlledTerms ?? [], rationale: input.rationale ?? "Added by you", origin: "user", sortOrder: n }).run());
  (await logDecision(projectId, 2, "topic_added", null, input));
  (await touchTopics(projectId, `Topic "${input.name}" was added`));
  return id;
}

export async function updateTopic(projectId: string, topicId: string, patch: { name?: string; synonyms?: string[]; controlledTerms?: string[]; rationale?: string }) {
  const before = (await db.select().from(schema.topics).where(eq(schema.topics.id, topicId)).get());
  if (!before || before.projectId !== projectId) throw new HttpError(404, "Topic not found");
  const set: Partial<typeof schema.topics.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name.trim();
  if (patch.synonyms) set.synonyms = patch.synonyms.map((s) => s.trim()).filter(Boolean);
  if (patch.controlledTerms) set.controlledTerms = patch.controlledTerms.map((s) => s.trim()).filter(Boolean);
  if (patch.rationale !== undefined) set.rationale = patch.rationale;
  (await db.update(schema.topics).set(set).where(eq(schema.topics.id, topicId)).run());
  (await logDecision(projectId, 2, "topic_edited", before, { ...before, ...set }));
  (await touchTopics(projectId, `Topic "${before.name}" was edited`));
}

export async function deleteTopic(projectId: string, topicId: string) {
  const before = (await db.select().from(schema.topics).where(eq(schema.topics.id, topicId)).get());
  if (!before || before.projectId !== projectId) throw new HttpError(404, "Topic not found");
  (await db.delete(schema.topics).where(eq(schema.topics.id, topicId)).run());
  (await logDecision(projectId, 2, "topic_deleted", before, null));
  (await touchTopics(projectId, `Topic "${before.name}" was deleted`));
}

/**
 * Undo a delete: the topic comes back exactly as it was (same id, so a suggestion is still a suggestion and a kept
 * one still kept; same origin, keywords and place in the list), from the record its deletion logged.
 */
export async function restoreTopic(projectId: string, topicId: string) {
  const logs = (await db.select({ before: schema.decisionLog.before }).from(schema.decisionLog).where(and(eq(schema.decisionLog.projectId, projectId), eq(schema.decisionLog.action, "topic_deleted"))).orderBy(desc(schema.decisionLog.createdAt)).all());
  const row = logs.map((l) => l.before as typeof schema.topics.$inferSelect | null).find((b) => b?.id === topicId && b.projectId === projectId);
  if (!row) throw new HttpError(404, "Topic not found");
  const current = (await db.select({ id: schema.topics.id }).from(schema.topics).where(eq(schema.topics.projectId, projectId)).all());
  if (current.some((t) => t.id === topicId)) throw new HttpError(409, "This topic is already back.");
  if (current.length >= 8) throw new HttpError(400, "A review can have at most 8 topics. Merge or delete one first.");
  (await db.insert(schema.topics).values({ ...row }).run());
  (await logDecision(projectId, 2, "topic_restored", null, row));
  (await touchTopics(projectId, `Topic "${row.name}" was brought back`));
}

export async function mergeTopics(projectId: string, ids: string[], name: string) {
  if (ids.length < 2) throw new HttpError(400, "Pick at least two topics to merge.");
  const rows = (await db.select().from(schema.topics).where(inArray(schema.topics.id, ids)).all()).filter((r) => r.projectId === projectId);
  if (rows.length !== ids.length) throw new HttpError(404, "Topic not found");
  const uniq = (a: string[]) => [...new Set(a.map((x) => x.trim()).filter(Boolean))];
  const id = newId("t");
  {
    const stmts: BatchItem<"sqlite">[] = [];
        stmts.push(db.insert(schema.topics).values({
                id,
                projectId,
                name: name.trim() || rows.map((r) => r.name).join(" / "),
                synonyms: uniq(rows.flatMap((r) => [r.name, ...r.synonyms])).slice(0, 16),
                controlledTerms: uniq(rows.flatMap((r) => r.controlledTerms)),
                rationale: `Merged from: ${rows.map((r) => r.name).join("; ")}`,
                origin: "merged",
                sortOrder: Math.min(...rows.map((r) => r.sortOrder)),
              }));
        stmts.push(db.delete(schema.topics).where(inArray(schema.topics.id, ids)));
        await batchWrite(stmts);
  }
  (await logDecision(projectId, 2, "topics_merged", rows.map((r) => r.name), { name, id }));
  (await touchTopics(projectId, `Topics merged into "${name}"`));
  return id;
}

export async function approveTopics(projectId: string) {
  const rows = (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).all());
  if (rows.length < 1) throw new HttpError(400, "Add at least one topic before approving.");
  if (rows.length > 8) throw new HttpError(400, "Keep at most 8 topics.");
  (await db.update(schema.topics).set({ approved: true }).where(eq(schema.topics.projectId, projectId)).run());
}
