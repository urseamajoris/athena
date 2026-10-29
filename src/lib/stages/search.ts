import "server-only";
import { asc, eq } from "drizzle-orm";
import { db, schema, batchWrite, type BatchItem } from "../db";
import type { Criteria } from "../db/schema";
import { structuredCall, unknownIds } from "../ai/client";
import { wrapData } from "../ai/prompts";
import { SearchBuild } from "./ai-schemas";
import { getProject, HttpError, logDecision, markDownstreamStale, setStageState } from "../project";
import { newId, nowIso, errMsg } from "../util";
import { adapters } from "../sources";
import { SEARCH_DATABASES, type SearchDatabase } from "../sources/types";
import { dropEmptyGroups, withBlock } from "../sources/syntax";
import { ideaSetting, yearsFromTimeframe } from "../shared/scope";

export async function searchState(projectId: string) {
  const p = (await getProject(projectId));
  const topics = (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.sortOrder)).all());
  const qs = (await db.select().from(schema.queries).where(eq(schema.queries.projectId, projectId)).all());
  return {
    criteria: p.criteria,
    databases: SEARCH_DATABASES.map((d) => ({ id: d, label: adapters[d].label })),
    topics: topics.map((t) => ({ ...t, queries: qs.filter((q) => q.topicId === t.id) })),
  };
}

export async function buildQueries(projectId: string) {
  const p = (await getProject(projectId));
  const topics = (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.sortOrder)).all());
  if (!topics.length) throw new HttpError(400, "No topics to build queries for.");
  const topicIds = topics.map((t) => t.id);
  const setting = ideaSetting(p.scopingSummary);
  const { data } = await structuredCall({
    prompt: "search_builder",
    role: "fast",
    schema: SearchBuild,
    projectId,
    stage: 3,
    vars: {
      idea: wrapData("research idea", p.idea),
      summary: wrapData("scoping summary", JSON.stringify(p.scopingSummary ?? {}, null, 1)),
      topics: wrapData("topics", topics.map((t) => `${t.id} — ${t.name} — ${t.synonyms.join("; ")} — ${t.controlledTerms.join("; ") || "none"}`).join("\n")),
      databases: SEARCH_DATABASES.join(", "),
      syntax: SEARCH_DATABASES.map((d) => `- ${d}: ${adapters[d].syntaxGuide}`).join("\n"),
      setting: setting ? wrapData("setting", setting) : "none named",
      year: String(new Date().getFullYear()),
    },
    check: (o) => {
      const bad = unknownIds(o.queries.map((q) => q.topicId), topicIds);
      if (bad.length) return `Unknown topicId(s): ${bad.join(", ")}. Use only: ${topicIds.join(", ")}`;
      const missing: string[] = [];
      for (const t of topicIds) for (const d of SEARCH_DATABASES) if (!o.queries.some((q) => q.topicId === t && q.database === d)) missing.push(`${t}/${d}`);
      if (missing.length) return `Missing a query for: ${missing.join(", ")}`;
      const noBlock = setting ? SEARCH_DATABASES.filter((d) => !o.settingBlocks.some((b) => b.database === d)) : [];
      return noBlock.length ? `The idea is limited to the setting "${setting}": give a settingBlocks entry for ${noBlock.join(", ")}.` : null;
    },
  });
  // Every search keeps the idea's setting (unless its topic compares settings), whatever the AI wrote per topic.
  const blocks = new Map(setting ? data.settingBlocks.map((b) => [b.database, dropEmptyGroups(b.block)]) : []);
  // The years come from the scoping answer when it names them ("last 5 years" in 2026 = 2021 to now), not the AI's arithmetic.
  const years = yearsFromTimeframe(p.scopingSummary?.timeframe);
  const criteria = years ? { ...data.criteria, ...years } : data.criteria;
  const had = (await db.select().from(schema.queries).where(eq(schema.queries.projectId, projectId)).all());
  {
    const stmts: BatchItem<"sqlite">[] = [];
        stmts.push(db.delete(schema.queries).where(eq(schema.queries.projectId, projectId)));
        const seen = new Set<string>();
        for (const q of data.queries) {
          const k = `${q.topicId}/${q.database}`;
          if (seen.has(k)) continue; // one query per database per topic
          seen.add(k);
          const block = q.comparesSettings ? undefined : blocks.get(q.database);
          const limited = block ? withBlock(dropEmptyGroups(q.query), block) : { query: dropEmptyGroups(q.query), added: false }; // never show or run "AND ()"
          const query = limited.query;
          const rationale = limited.added ? `${q.rationale} Also limited to ${setting}, the setting of your idea.` : q.rationale;
          stmts.push(db.insert(schema.queries).values({ id: newId("q"), projectId, topicId: q.topicId, database: q.database, queryString: query, aiQueryString: query, rationale }));
        }
        stmts.push(db.update(schema.projects).set({ criteria, updatedAt: nowIso() }).where(eq(schema.projects.id, projectId)));
        await batchWrite(stmts);
  }
  (await logDecision(projectId, 3, "queries_generated", had.length ? had.map((h) => h.queryString) : null, { ...data, criteria }, "ai"));
  (await setStageState(projectId, 3, "needs_review"));
  if (had.length) (await markDownstreamStale(projectId, 3, "Search queries were regenerated"));
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
