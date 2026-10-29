import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db, schema } from "../db";
import { config } from "../config";
import { adapters } from "../sources";
import type { SourceRecord, SearchDatabase } from "../sources/types";
import { openalexByDois, openalexByPmids } from "../sources/openalex";
import { crossrefFindByTitle } from "../sources/crossref";
import { unpaywall } from "../sources/unpaywall";
import { getProject, logDecision } from "../project";
import { newId, nowIso, normalizeTitle, errMsg, forEachSeq } from "../util";
import type { JobContext } from "./runner";

type Paper = typeof schema.papers.$inferSelect;

/** Dedup order: DOI, then PMID, then normalised title. */
export async function findExisting(projectId: string, r: SourceRecord): Promise<Paper | undefined> {
  const P = schema.papers;
  if (r.doi) {
    const m = (await db.select().from(P).where(and(eq(P.projectId, projectId), eq(P.doi, r.doi))).get());
    if (m) return m;
  }
  if (r.pmid) {
    const m = (await db.select().from(P).where(and(eq(P.projectId, projectId), eq(P.pmid, r.pmid))).get());
    if (m) return m;
  }
  if (r.openalexId) {
    const m = (await db.select().from(P).where(and(eq(P.projectId, projectId), eq(P.openalexId, r.openalexId))).get());
    if (m) return m;
  }
  const nt = normalizeTitle(r.title);
  if (nt.length > 15) {
    const m = (await db.select().from(P).where(and(eq(P.projectId, projectId), eq(P.normTitle, nt))).get());
    if (m) return m;
  }
  return undefined;
}

/** Merge a record into an existing paper: fill gaps, never overwrite with nulls. */
export function mergeInto(p: Paper, r: SourceRecord, source: string): Partial<Paper> {
  const set: Partial<Paper> = {};
  const fill = <K extends keyof Paper>(k: K, v: Paper[K] | null | undefined) => {
    if ((p[k] === null || p[k] === undefined || p[k] === "") && v !== null && v !== undefined && v !== "") (set as Record<string, unknown>)[k as string] = v;
  };
  fill("doi", r.doi);
  fill("pmid", r.pmid);
  fill("pmcid", r.pmcid);
  fill("openalexId", r.openalexId);
  fill("journal", r.journal);
  fill("year", r.year);
  fill("language", r.language);
  fill("oaUrl", r.oaUrl);
  fill("oaStatus", r.oaStatus);
  fill("license", r.license);
  if (r.abstract && (!p.abstract || r.abstract.length > p.abstract.length * 1.2)) set.abstract = r.abstract;
  if (r.citationCount !== null && (p.citationCount === null || r.citationCount > p.citationCount)) set.citationCount = r.citationCount;
  if (!p.authors.length && r.authors.length) set.authors = r.authors;
  const types = [...new Set([...p.publicationTypes, ...r.publicationTypes])];
  if (types.length !== p.publicationTypes.length) set.publicationTypes = types;
  if (!p.sourceDatabases.includes(source)) set.sourceDatabases = [...p.sourceDatabases, source];
  return set;
}

async function upsert(projectId: string, r: SourceRecord, source: string): Promise<{ paperId: string; isNew: boolean }> {
  const ex = (await findExisting(projectId, r));
  if (ex) {
    const set = mergeInto(ex, r, source);
    if (Object.keys(set).length) (await db.update(schema.papers).set(set).where(eq(schema.papers.id, ex.id)).run());
    return { paperId: ex.id, isNew: false };
  }
  const id = newId("p");
  (await db.insert(schema.papers).values({
        id,
        projectId,
        doi: r.doi,
        pmid: r.pmid,
        pmcid: r.pmcid,
        openalexId: r.openalexId,
        title: r.title,
        normTitle: normalizeTitle(r.title),
        authors: r.authors,
        year: r.year,
        journal: r.journal,
        abstract: r.abstract,
        language: r.language,
        publicationTypes: r.publicationTypes,
        citationCount: r.citationCount,
        oaUrl: r.oaUrl,
        oaStatus: r.oaStatus,
        license: r.license,
        sourceDatabases: [source],
      }).run());
  return { paperId: id, isNew: true };
}

export async function retrievalJob(ctx: JobContext) {
  const { projectId } = ctx;
  const p = (await getProject(projectId));
  const cap = Number(ctx.params.cap ?? config.maxResultsPerQuery);
  const topics = (await db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.sortOrder)).all());
  const qs = (await db.select().from(schema.queries).where(eq(schema.queries.projectId, projectId)).all());
  const ordered = topics.flatMap((t) => qs.filter((q) => q.topicId === t.id).sort((a, b) => a.database.localeCompare(b.database) * -1)); // pubmed first

  // Resume support: if runs exist for this job, keep finished ones; otherwise start fresh.
  let runs = (await db.select().from(schema.searchRuns).where(eq(schema.searchRuns.jobId, ctx.jobId)).orderBy(asc(schema.searchRuns.order)).all());
  if (!runs.length) {
    // Fresh retrieval replaces earlier results (downstream derived data cascades).
    (await db.delete(schema.papers).where(eq(schema.papers.projectId, projectId)).run());
    (await db.delete(schema.searchRuns).where(eq(schema.searchRuns.projectId, projectId)).run());
    await forEachSeq(ordered, async (q, i) =>
      (await db.insert(schema.searchRuns).values({ id: newId("run"), projectId, queryId: q.id, jobId: ctx.jobId, database: q.database, queryString: q.queryString, criteria: p.criteria, cap, order: i }).run()),
    );
    runs = (await db.select().from(schema.searchRuns).where(eq(schema.searchRuns.jobId, ctx.jobId)).orderBy(asc(schema.searchRuns.order)).all());
  }
  const total = runs.length + 1;
  const failedSources = new Set<string>();

  for (const [i, run] of runs.entries()) {
    if ((await ctx.cancelled())) return;
    if (run.status === "done" || run.status === "failed") continue;
    const q = qs.find((x) => x.id === run.queryId)!;
    const topic = topics.find((t) => t.id === q.topicId)!;
    (await ctx.progress(i, total, `${adapters[run.database as SearchDatabase].label}: ${topic.name}`));
    (await db.update(schema.searchRuns).set({ status: "running", startedAt: nowIso(), fetchedCount: 0, newUniqueCount: 0 }).where(eq(schema.searchRuns.id, run.id)).run());
    // If interrupted mid-run, remove partial hits for this run.
    (await db.delete(schema.paperHits).where(eq(schema.paperHits.searchRunId, run.id)).run());
    const reqLog: string[] = [];
    let rank = 0;
    let fetched = 0;
    let newCount = 0;
    try {
      const res = await adapters[run.database as SearchDatabase].search(run.queryString, run.criteria, run.cap, {
        log: async (l) => {
          reqLog.push(l);
          (await ctx.log(l));
        },
        onPage: async (recs, tot) => {
          // No transaction: upsert() reads through the shared client, which a libSQL write transaction would block.
          {
                        for (const r of recs) {
                          const { paperId, isNew } = (await upsert(projectId, r, run.database));
                          (await db.insert(schema.paperTopics).values({ paperId, topicId: topic.id }).onConflictDoNothing().run());
                          (await db.insert(schema.paperHits).values({ paperId, searchRunId: run.id, rank: rank++, wasNew: isNew }).onConflictDoNothing().run());
                          if (isNew) newCount++;
                          fetched++;
                        }
                      }
          (await db.update(schema.searchRuns).set({ resultCount: tot, fetchedCount: fetched, newUniqueCount: newCount, requestLog: reqLog.slice(-50) }).where(eq(schema.searchRuns.id, run.id)).run());
        },
      });
      (await db.update(schema.searchRuns).set({ status: "done", resultCount: res.total, fetchedCount: fetched, newUniqueCount: newCount, endedAt: nowIso(), requestLog: reqLog.slice(-50) }).where(eq(schema.searchRuns.id, run.id)).run());
      (await ctx.log(`✓ ${run.database} "${topic.name}": ${res.total} hits, fetched ${fetched}, ${newCount} new unique`));
    } catch (e) {
      failedSources.add(run.database);
      (await db.update(schema.searchRuns).set({ status: "failed", error: errMsg(e), fetchedCount: fetched, newUniqueCount: newCount, endedAt: nowIso(), requestLog: reqLog.slice(-50) }).where(eq(schema.searchRuns.id, run.id)).run());
      (await ctx.log(`✗ ${run.database} "${topic.name}" failed: ${errMsg(e)} — continuing with other sources`));
    }
  }

  (await ctx.progress(runs.length, total, "Filling metadata gaps (OpenAlex, Crossref, Unpaywall)"));
  await enrich(ctx);
  const n = (await db.select({ n: sql<number>`count(*)` }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).get())?.n ?? 0;
  const finalRuns = (await db.select().from(schema.searchRuns).where(eq(schema.searchRuns.jobId, ctx.jobId)).all());
  (await logDecision(projectId, 4, "retrieval_completed", null, {
        uniquePapers: n,
        runs: finalRuns.map((r) => ({ database: r.database, query: r.queryString, total: r.resultCount, fetched: r.fetchedCount, newUnique: r.newUniqueCount, status: r.status, error: r.error })),
      }, "system"));
  (await ctx.progress(total, total, `Done: ${n} unique papers`));
  if (finalRuns.length && finalRuns.every((r) => r.status === "failed")) throw new Error("Every query failed. Check the errors below and your network/API keys.");
}

/** Fill gaps from other sources. Each source failing is logged and skipped. */
async function enrich(ctx: JobContext) {
  const { projectId } = ctx;
  const P = schema.papers;
  const log = async (l: string) => (await ctx.log(l));

  // 1. OpenAlex batch lookups: citation counts and OA links for PubMed-only records (cheap list+filter calls).
  try {
    const noOA = (await db.select().from(P).where(and(eq(P.projectId, projectId), isNull(P.openalexId))).all());
    const byDoi = noOA.filter((p) => p.doi).map((p) => p.doi!);
    const byPmid = noOA.filter((p) => !p.doi && p.pmid).map((p) => p.pmid!);
    const recs = [...(byDoi.length ? await openalexByDois(byDoi, log) : []), ...(byPmid.length ? await openalexByPmids(byPmid, log) : [])];
    let merged = 0;
    for (const r of recs) {
      const ex = (await findExisting(projectId, r));
      if (!ex) continue;
      const set = mergeInto(ex, r, "openalex");
      delete set.sourceDatabases; // enrichment is not a search hit
      set.enrichment = { ...ex.enrichment, openalex: "metadata" };
      (await db.update(P).set(set).where(eq(P.id, ex.id)).run());
      merged++;
    }
    (await ctx.log(`OpenAlex enrichment: matched ${merged} of ${noOA.length} records`));
  } catch (e) {
    (await ctx.log(`OpenAlex enrichment failed (continuing): ${errMsg(e)}`));
  }

  // 2. Crossref: find DOIs for records without one (exact title match only).
  try {
    const noDoi = (await db.select().from(P).where(and(eq(P.projectId, projectId), isNull(P.doi))).all()).slice(0, 60);
    let found = 0;
    for (const p of noDoi) {
      if ((await ctx.cancelled())) return;
      const m = await crossrefFindByTitle(p.title, p.year, log);
      if (m) {
        const dup = m.doi ? (await db.select().from(P).where(and(eq(P.projectId, projectId), eq(P.doi, m.doi))).get()) : undefined;
        if (dup) continue;
        (await db.update(P).set({ doi: m.doi, journal: p.journal ?? m.journal, citationCount: p.citationCount ?? m.citationCount, enrichment: { ...p.enrichment, crossref: "doi" } }).where(eq(P.id, p.id)).run());
        found++;
      }
    }
    (await ctx.log(`Crossref: found DOIs for ${found} of ${noDoi.length} records without one`));
  } catch (e) {
    (await ctx.log(`Crossref enrichment failed (continuing): ${errMsg(e)}`));
  }

  // 3. Unpaywall: OA links for records with a DOI but no OA link yet.
  try {
    const noLink = (await db.select().from(P).where(and(eq(P.projectId, projectId), isNull(P.oaUrl))).all()).filter((p) => p.doi).slice(0, 200);
    let found = 0;
    for (const p of noLink) {
      if ((await ctx.cancelled())) return;
      const u = await unpaywall(p.doi!, log);
      if (u?.isOa && (u.url || u.pdfUrl)) {
        (await db.update(P).set({ oaUrl: u.url ?? u.pdfUrl, oaStatus: u.oaStatus, license: p.license ?? u.license, enrichment: { ...p.enrichment, unpaywall: "oa_link" } }).where(eq(P.id, p.id)).run());
        found++;
      }
    }
    (await ctx.log(`Unpaywall: found open-access links for ${found} of ${noLink.length} records`));
  } catch (e) {
    (await ctx.log(`Unpaywall enrichment failed (continuing): ${errMsg(e)}`));
  }
}
