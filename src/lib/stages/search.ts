import "server-only";
import { eq, inArray } from "drizzle-orm";
import { db, schema, batchWrite, type BatchItem } from "../db";
import type { Criteria } from "../db/schema";
import { structuredCall, unknownIds, isAiStop } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { SearchBuild } from "./ai-schemas";
import { getProject, HttpError, logDecision, markDownstreamStale, setStageState } from "../project";
import { newId, nowIso, errMsg } from "../util";
import { adapters } from "../sources";
import { SEARCH_DATABASES, type SearchDatabase } from "../sources/types";
import { dropEmptyGroups } from "../sources/syntax";
import { questionText, topicsWithoutQueries, workingQuestion } from "./rules";
import { generateTopics, listTopics } from "./topics";
import type { PromptVars } from "./prompt-vars";

/*
 * Stage 3, the search plan: the search topics written from the working research question, one query per
 * database per topic, and the shared criteria. Approving the stage runs the searches.
 */

export async function searchState(projectId: string) {
  const p = (await getProject(projectId));
  const topics = (await listTopics(projectId));
  const qs = (await db.select().from(schema.queries).where(eq(schema.queries.projectId, projectId)).all());
  return {
    criteria: p.criteria,
    databases: SEARCH_DATABASES.map((d) => ({ id: d, label: adapters[d].label })),
    topics: topics.map((t) => ({ ...t, queries: qs.filter((q) => q.topicId === t.id) })),
    /** Topics with no searches yet. The search plan cannot be confirmed while any is listed. */
    missing: topicsWithoutQueries(topics, qs).map((t) => ({ id: t.id, name: t.name })),
    conceptMap: p.conceptMap,
    summary: p.scopingSummary,
  };
}

/**
 * Build the search plan in one action: the search topics from the working research question, then the database
 * searches for every topic. If the searches fail after the topics were written, the topics stay and the error
 * says so; `buildQueries` writes the missing searches later.
 */
export async function buildSearchPlan(projectId: string) {
  const p = (await getProject(projectId));
  if (!workingQuestion(p)) throw new HttpError(409, "Confirm your research question first.");
  const wrote = (await generateTopics(projectId));
  try {
    (await buildQueries(projectId, "all"));
  } catch (e) {
    if (wrote && e instanceof Error) {
      const why = e.message;
      const message = `Your search topics are ready, but the searches could not be written. ${why}`;
      // AI stops (AI off, no key, no budget, no credits) keep their own error type, so the client still sees which.
      if (isAiStop(e)) {
        e.message = message;
        throw e;
      }
      throw new HttpError(502, `${message.replace(/\.?\s*$/, ".")} You can write the searches again without losing the topics.`);
    }
    throw e;
  }
  return (await searchState(projectId));
}

/**
 * Write the database searches for some topics, replacing the ones those topics have. `scope`:
 *   "missing"       only topics that have no searches (the default; nothing the user has is touched);
 *   { topicIds }    exactly these topics (to write one topic's searches again);
 *   "all"           every topic, and the shared criteria again.
 * Other topics keep their searches, and criteria that already exist are kept unless the scope is "all".
 */
export async function buildQueries(projectId: string, scope: "missing" | "all" | { topicIds: string[] } = "missing") {
  const p = (await getProject(projectId));
  const topics = (await listTopics(projectId));
  if (!topics.length) throw new HttpError(400, "There are no search topics yet. Build the search plan or add a topic first.");
  const had = (await db.select().from(schema.queries).where(eq(schema.queries.projectId, projectId)).all());
  const named = typeof scope === "object" ? scope.topicIds : null;
  if (named?.some((id) => !topics.some((t) => t.id === id))) throw new HttpError(404, "Topic not found");
  const targets = named ? topics.filter((t) => named.includes(t.id)) : scope === "all" ? topics : topicsWithoutQueries(topics, had);
  if (!targets.length) throw new HttpError(409, "Every topic already has its searches.");
  const others = topics.filter((t) => !targets.includes(t));
  const topicIds = targets.map((t) => t.id);
  const line = (t: (typeof topics)[number]) => `${t.id} — ${t.name} — ${t.synonyms.join("; ")} — ${t.controlledTerms.join("; ") || "none"}`;
  const { data } = await structuredCall({
    prompt: "search_builder",
    role: "fast",
    schema: SearchBuild,
    projectId,
    stage: 3,
    vars: {
      question: wrapData("working research question", questionText(workingQuestion(p))),
      idea: wrapData("research idea", p.idea),
      summary: wrapData("scope", JSON.stringify(p.scopingSummary ?? {}, null, 1)),
      topics: wrapData("topics", targets.map(line).join("\n")),
      otherTopics: wrapData("other topics", others.length ? others.map((t) => `${t.name} — ${t.synonyms.join("; ")}`).join("\n") : "(none)"),
      databases: SEARCH_DATABASES.join(", "),
      syntax: SEARCH_DATABASES.map((d) => `- ${d}: ${adapters[d].syntaxGuide}`).join("\n"),
    } satisfies PromptVars<"search_builder">,
    check: (o) => {
      const bad = unknownIds(o.queries.map((q) => q.topicId), topicIds);
      if (bad.length) return `Unknown topicId(s): ${bad.join(", ")}. Use only: ${topicIds.join(", ")}`;
      const missing: string[] = [];
      for (const t of topicIds) for (const d of SEARCH_DATABASES) if (!o.queries.some((q) => q.topicId === t && q.database === d)) missing.push(`${t}/${d}`);
      return missing.length ? `Missing a query for: ${missing.join(", ")}` : null;
    },
  });
  const replaced = had.filter((h) => topicIds.includes(h.topicId));
  {
    const stmts: BatchItem<"sqlite">[] = [];
    if (replaced.length) stmts.push(db.delete(schema.queries).where(inArray(schema.queries.id, replaced.map((r) => r.id))));
    const seen = new Set<string>();
    for (const q of data.queries) {
      const k = `${q.topicId}/${q.database}`;
      if (seen.has(k)) continue; // one query per database per topic
      seen.add(k);
      const query = dropEmptyGroups(q.query); // never show or run "AND ()"
      stmts.push(db.insert(schema.queries).values({ id: newId("q"), projectId, topicId: q.topicId, database: q.database, queryString: query, aiQueryString: query, rationale: q.rationale }));
    }
    // Criteria the user already has are theirs: only a full rewrite, or a plan that has none yet, takes the AI's.
    if (scope === "all" || !p.criteria) stmts.push(db.update(schema.projects).set({ criteria: data.criteria, updatedAt: nowIso() }).where(eq(schema.projects.id, projectId)));
    await batchWrite(stmts);
  }
  (await logDecision(projectId, 3, "queries_generated", replaced.length ? replaced.map((h) => h.queryString) : null, { scope, ...data }, "ai"));
  (await setStageState(projectId, 3, "needs_review"));
  if (had.length) (await markDownstreamStale(projectId, 3, replaced.length ? "Searches were written again" : "Searches were written for a new topic"));
  return (await searchState(projectId));
}

export async function updateQuery(projectId: string, queryId: string, queryString: string) {
  const q = (await db.select().from(schema.queries).where(eq(schema.queries.id, queryId)).get());
  if (!q || q.projectId !== projectId) throw new HttpError(404, "Query not found");
  if (q.queryString === queryString) return;
  (await db.update(schema.queries).set({ queryString, edited: queryString !== q.aiQueryString, dryRunCount: null, dryRunAt: null, dryRunError: null }).where(eq(schema.queries.id, queryId)).run());
  (await logDecision(projectId, 3, "query_edited", q.queryString, queryString));
  (await markDownstreamStale(projectId, 3, "A search query was edited"));
}

export async function updateCriteria(projectId: string, criteria: Criteria) {
  const p = (await getProject(projectId));
  (await db.update(schema.projects).set({ criteria, updatedAt: nowIso() }).where(eq(schema.projects.id, projectId)).run());
  // Counts depend only on years, languages and the hard filter: other criteria (inclusion, exclusion, study types) keep them.
  const counted = (c: Criteria | null) => JSON.stringify([c?.yearFrom ?? null, c?.yearTo ?? null, c?.languages ?? [], c?.hardFilter ?? []]);
  if (counted(p.criteria) !== counted(criteria)) (await db.update(schema.queries).set({ dryRunCount: null, dryRunAt: null }).where(eq(schema.queries.projectId, projectId)).run());
  (await logDecision(projectId, 3, "criteria_edited", p.criteria, criteria));
  const was = (p.criteria?.hardFilter ?? []).join(",");
  const now = (criteria.hardFilter ?? []).join(",");
  if (was !== now) (await logDecision(projectId, 3, now ? "hard_retrieval_filter_set" : "hard_retrieval_filter_removed", was || null, now || null));
  (await markDownstreamStale(projectId, 3, "Inclusion/exclusion criteria were edited"));
}

export async function dryRun(projectId: string, queryId: string) {
  const q = (await db.select().from(schema.queries).where(eq(schema.queries.id, queryId)).get());
  if (!q || q.projectId !== projectId) throw new HttpError(404, "Query not found");
  const p = (await getProject(projectId));
  try {
    const n = await adapters[q.database as SearchDatabase].count(q.queryString, p.criteria);
    (await db.update(schema.queries).set({ dryRunCount: n, dryRunAt: nowIso(), dryRunError: null }).where(eq(schema.queries.id, queryId)).run());
    (await logDecision(projectId, 3, "dry_run", null, { queryId, database: q.database, query: q.queryString, count: n }, "system"));
    return { count: n, error: null };
  } catch (e) {
    (await db.update(schema.queries).set({ dryRunCount: null, dryRunAt: nowIso(), dryRunError: errMsg(e) }).where(eq(schema.queries.id, queryId)).run());
    return { count: null, error: errMsg(e) };
  }
}

export async function dryRunAll(projectId: string) {
  const qs = (await db.select().from(schema.queries).where(eq(schema.queries.projectId, projectId)).all());
  const out = [];
  for (const q of qs) out.push({ id: q.id, ...(await dryRun(projectId, q.id)) });
  return out;
}
