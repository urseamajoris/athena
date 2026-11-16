import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { db, schema, batchWrite, type BatchItem } from "../db";
import { structuredCall } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { SearchTopics } from "./ai-schemas";
import { getProject, HttpError, logDecision, markDownstreamStale, setStageState } from "../project";
import { newId, nowIso } from "../util";
import { MAX_TOPICS, questionText, workingQuestion } from "./rules";
import { transcript } from "./scoping";
import type { PromptVars } from "./prompt-vars";

/*
 * Search topics belong to the search plan (stage 3). They have no checkpoint of their own: every topic is part
 * of the stage 3 checkpoint, so `approved` is set when a topic is made, and any change to the topics reopens
 * stage 3 and marks the later stages out of date.
 */

const MIN_AI_TOPICS = 4;
const TOO_MANY = `A review can have at most ${MAX_TOPICS} topics. Merge or delete one first.`;

export async function listTopics(projectId: string) {
  return (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.sortOrder)).all());
}

/** The topics changed: stage 3 opens for review (also from "not started") and later stages go stale. */
async function touchTopics(projectId: string, why: string) {
  if ((await getProject(projectId)).stageStates["3"] === "not_started") (await setStageState(projectId, 3, "needs_review"));
  (await markDownstreamStale(projectId, 3, why));
}

/**
 * Write the search topics and the concept map from the working research question (plus the idea and the chat).
 * AI-made topics are replaced; topics the user added or merged stay, and the model is told about them so that it
 * covers the rest of the question. Returns false when the user's own topics already fill the review.
 */
export async function generateTopics(projectId: string): Promise<boolean> {
  const p = (await getProject(projectId));
  const before = (await listTopics(projectId));
  const kept = before.filter((t) => t.origin !== "ai");
  const room = MAX_TOPICS - kept.length;
  if (room < 1) return false;
  const min = Math.max(1, Math.min(MIN_AI_TOPICS - kept.length, room));
  const t = (await transcript(projectId));
  const { data } = await structuredCall({
    prompt: "scoping_topics",
    role: "fast",
    schema: SearchTopics,
    projectId,
    stage: 3,
    vars: {
      question: wrapData("working research question", questionText(workingQuestion(p))),
      idea: wrapData("research idea", p.idea),
      transcript: wrapData("conversation", t.text),
      existing: wrapData("researcher's own topics", kept.length ? kept.map((k) => `${k.name} — ${k.synonyms.join("; ") || "no synonyms"}`).join("\n") : "(none)"),
      minTopics: String(min),
      maxTopics: String(room),
    } satisfies PromptVars<"scoping_topics">,
    check: (o) => {
      if (o.topics.length < min || o.topics.length > room) return `Return between ${min} and ${room} topics (you returned ${o.topics.length}).`;
      const taken = new Set(kept.map((k) => k.name.trim().toLowerCase()));
      const repeated = o.topics.filter((x) => taken.has(x.name.trim().toLowerCase()));
      if (repeated.length) return `Do not repeat the researcher's own topics: ${repeated.map((x) => x.name).join(", ")}`;
      const ids = new Set(o.conceptMap.nodes.map((n) => n.id));
      const bad = o.conceptMap.edges.filter((e) => !ids.has(e.from) || !ids.has(e.to));
      return bad.length ? `conceptMap edges reference unknown node ids: ${bad.map((b) => `${b.from}->${b.to}`).join(", ")}` : null;
    },
  });
  const stmts: BatchItem<"sqlite">[] = [];
  const old = before.filter((b) => b.origin === "ai").map((b) => b.id);
  if (old.length) stmts.push(db.delete(schema.topics).where(and(eq(schema.topics.projectId, projectId), inArray(schema.topics.id, old))));
  kept.forEach((k, i) => stmts.push(db.update(schema.topics).set({ sortOrder: i }).where(eq(schema.topics.id, k.id))));
  data.topics.forEach((tp, i) =>
    stmts.push(db.insert(schema.topics).values({ id: newId("t"), projectId, name: tp.name, synonyms: tp.synonyms, controlledTerms: tp.controlledTerms, rationale: tp.rationale, sortOrder: kept.length + i, origin: "ai", approved: true })),
  );
  stmts.push(db.update(schema.projects).set({ conceptMap: data.conceptMap, scopingSummary: data.summary, updatedAt: nowIso() }).where(eq(schema.projects.id, projectId)));
  await batchWrite(stmts);
  (await logDecision(projectId, 3, "topics_generated", before.map((b) => b.name), [...kept.map((k) => k.name), ...data.topics.map((x) => x.name)], "ai"));
  (await setStageState(projectId, 3, "needs_review"));
  if (before.length) (await markDownstreamStale(projectId, 3, "The search topics were written again"));
  return true;
}

export async function addTopic(projectId: string, input: { name: string; synonyms?: string[]; controlledTerms?: string[]; rationale?: string }) {
  const n = (await listTopics(projectId)).length;
  if (n >= MAX_TOPICS) throw new HttpError(400, TOO_MANY);
  const id = newId("t");
  (await db.insert(schema.topics).values({ id, projectId, name: input.name.trim(), synonyms: input.synonyms ?? [], controlledTerms: input.controlledTerms ?? [], rationale: input.rationale ?? "Added by you", origin: "user", sortOrder: n, approved: true }).run());
  (await logDecision(projectId, 3, "topic_added", null, input));
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
  if (!Object.keys(set).length) return;
  (await db.update(schema.topics).set(set).where(eq(schema.topics.id, topicId)).run());
  (await logDecision(projectId, 3, "topic_edited", before, { ...before, ...set }));
  (await touchTopics(projectId, `Topic "${before.name}" was edited`));
}

export async function deleteTopic(projectId: string, topicId: string) {
  const before = (await db.select().from(schema.topics).where(eq(schema.topics.id, topicId)).get());
  if (!before || before.projectId !== projectId) throw new HttpError(404, "Topic not found");
  (await db.delete(schema.topics).where(eq(schema.topics.id, topicId)).run());
  (await logDecision(projectId, 3, "topic_deleted", before, null));
  (await touchTopics(projectId, `Topic "${before.name}" was deleted`));
}

/**
 * Undo a delete: the topic comes back exactly as it was (same id, origin, keywords and place in the list), from
 * the record its deletion logged. Its searches were deleted with it and have to be written again.
 */
export async function restoreTopic(projectId: string, topicId: string) {
  const logs = (await db.select({ before: schema.decisionLog.before }).from(schema.decisionLog).where(and(eq(schema.decisionLog.projectId, projectId), eq(schema.decisionLog.action, "topic_deleted"))).orderBy(desc(schema.decisionLog.createdAt)).all());
  const row = logs.map((l) => l.before as typeof schema.topics.$inferSelect | null).find((b) => b?.id === topicId && b.projectId === projectId);
  if (!row) throw new HttpError(404, "Topic not found");
  const current = (await db.select({ id: schema.topics.id }).from(schema.topics).where(eq(schema.topics.projectId, projectId)).all());
  if (current.some((t) => t.id === topicId)) throw new HttpError(409, "This topic is already back.");
  if (current.length >= MAX_TOPICS) throw new HttpError(400, TOO_MANY);
  (await db.insert(schema.topics).values({ ...row, approved: true }).run());
  (await logDecision(projectId, 3, "topic_restored", null, row));
  (await touchTopics(projectId, `Topic "${row.name}" was brought back`));
}

/** Merge topics into one. The merged topic starts without searches (those of its parts are deleted with them). */
export async function mergeTopics(projectId: string, ids: string[], name: string) {
  if (ids.length < 2) throw new HttpError(400, "Pick at least two topics to merge.");
  const rows = (await db.select().from(schema.topics).where(inArray(schema.topics.id, ids)).all()).filter((r) => r.projectId === projectId);
  if (rows.length !== ids.length) throw new HttpError(404, "Topic not found");
  const uniq = (a: string[]) => [...new Set(a.map((x) => x.trim()).filter(Boolean))];
  const id = newId("t");
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
    approved: true,
  }));
  stmts.push(db.delete(schema.topics).where(inArray(schema.topics.id, ids)));
  await batchWrite(stmts);
  (await logDecision(projectId, 3, "topics_merged", rows.map((r) => r.name), { name, id }));
  (await touchTopics(projectId, `Topics merged into "${name}"`));
  return id;
}
