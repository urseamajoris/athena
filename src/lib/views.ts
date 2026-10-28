import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { getProject, latestJob, stageCosts } from "./project";
import { STAGES, scrubIds } from "./shared/stages";

const ids = (a: string[]) => a.concat(["-"]);

type ClaimRow = typeof schema.claims.$inferSelect;
/** Number claims within each paper+field ("key finding 2") so citation chips can be told apart. */
function withOrdinals(cited: ClaimRow[]) {
  const appIds = [...new Set(cited.map((c) => c.appraisalId))];
  const all = db.select().from(schema.claims).where(inArray(schema.claims.appraisalId, ids(appIds))).orderBy(sql`rowid`).all();
  const ord = new Map<string, number>();
  const count = new Map<string, number>();
  for (const c of all) {
    const k = `${c.appraisalId}:${c.field}`;
    count.set(k, (count.get(k) ?? 0) + 1);
    ord.set(c.id, count.get(k)!);
  }
  return cited.map((c) => ({ ...c, ordinal: ord.get(c.id) ?? 1, ofField: count.get(`${c.appraisalId}:${c.field}`) ?? 1 }));
}

export function projectView(id: string) {
  const p = getProject(id);
  const jobs = Object.fromEntries(STAGES.filter((s) => s.job).map((s) => [String(s.n), latestJob(id, s.n) ?? null]));
  return { project: p, costs: stageCosts(id), jobs };
}

export function retrievalView(projectId: string) {
  const runs = db.select().from(schema.searchRuns).where(eq(schema.searchRuns.projectId, projectId)).orderBy(asc(schema.searchRuns.order)).all();
  const qs = db.select().from(schema.queries).where(eq(schema.queries.projectId, projectId)).all();
  const topics = db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).all();
  const job = latestJob(projectId, 4) ?? null;
  const total = db.select({ id: schema.papers.id }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all().length;
  return {
    job,
    uniquePapers: total,
    runs: runs.map((r) => ({ ...r, topicName: topics.find((t) => t.id === qs.find((q) => q.id === r.queryId)?.topicId)?.name ?? "(deleted topic)" })),
  };
}

export function papersView(projectId: string) {
  const papers = db.select().from(schema.papers).where(eq(schema.papers.projectId, projectId)).all();
  const pids = ids(papers.map((p) => p.id));
  const sums = db.select().from(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, pids)).all();
  const links = db.select().from(schema.paperTopics).where(inArray(schema.paperTopics.paperId, pids)).all();
  const topics = db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.sortOrder)).all();
  return {
    topics: topics.map((t) => ({ id: t.id, name: t.name })),
    papers: papers.map((p) => ({
      ...p,
      abstract: undefined,
      hasAbstract: !!p.abstract,
      summary: sums.find((s) => s.paperId === p.id) ?? null,
      topicIds: links.filter((l) => l.paperId === p.id).map((l) => l.topicId),
    })),
  };
}

export function paperDetail(projectId: string, paperId: string) {
  const p = db.select().from(schema.papers).where(and(eq(schema.papers.id, paperId), eq(schema.papers.projectId, projectId))).get();
  if (!p) return null;
  const hits = db.select().from(schema.paperHits).where(eq(schema.paperHits.paperId, paperId)).all();
  const runs = db.select().from(schema.searchRuns).where(inArray(schema.searchRuns.id, ids(hits.map((h) => h.searchRunId)))).all();
  const topics = db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).all();
  const qs = db.select().from(schema.queries).where(eq(schema.queries.projectId, projectId)).all();
  const scores = db.select().from(schema.scores).where(eq(schema.scores.paperId, paperId)).all();
  const summary = db.select().from(schema.paperSummaries).where(eq(schema.paperSummaries.paperId, paperId)).get() ?? null;
  const appraisal = db.select().from(schema.appraisals).where(eq(schema.appraisals.paperId, paperId)).get() ?? null;
  return {
    paper: p,
    summary,
    appraisal: appraisal ? { id: appraisal.id, status: appraisal.status, textSource: appraisal.textSource } : null,
    foundBy: hits.map((h) => {
      const r = runs.find((x) => x.id === h.searchRunId);
      const q = qs.find((x) => x.id === r?.queryId);
      return { database: r?.database, query: r?.queryString, topic: topics.find((t) => t.id === q?.topicId)?.name, rank: h.rank + 1, wasNew: h.wasNew };
    }),
    scores: scores.map((s) => ({ ...s, topicName: topics.find((t) => t.id === s.topicId)?.name })),
  };
}

export function rankingView(projectId: string) {
  const topics = db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.importanceRank), asc(schema.topics.sortOrder)).all();
  const scores = db.select().from(schema.scores).where(inArray(schema.scores.topicId, ids(topics.map((t) => t.id)))).orderBy(desc(schema.scores.total)).all();
  const papers = db.select().from(schema.papers).where(inArray(schema.papers.id, ids([...new Set(scores.map((s) => s.paperId))]))).all();
  const sums = db.select().from(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, ids(papers.map((p) => p.id)))).all();
  return {
    topics: topics.map((t) => ({
      ...t,
      scores: scores
        .filter((s) => s.topicId === t.id)
        .map((s) => {
          const p = papers.find((x) => x.id === s.paperId)!;
          return { ...s, paper: { id: p.id, title: p.title, year: p.year, journal: p.journal, citationCount: p.citationCount, studyType: sums.find((x) => x.paperId === p.id)?.studyType ?? null } };
        }),
    })),
  };
}

export function appraisalsView(projectId: string) {
  const papers = db.select().from(schema.papers).where(eq(schema.papers.projectId, projectId)).all();
  const apps = db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, ids(papers.map((p) => p.id)))).all();
  const claims = db.select().from(schema.claims).where(inArray(schema.claims.appraisalId, ids(apps.map((a) => a.id)))).all();
  return {
    appraisals: apps.map((a) => {
      const p = papers.find((x) => x.id === a.paperId)!;
      const cs = claims.filter((c) => c.appraisalId === a.id);
      return {
        ...a,
        paper: { id: p.id, title: p.title, year: p.year, doi: p.doi, pmid: p.pmid, pmcid: p.pmcid },
        counts: { claims: cs.length, verified: cs.filter((c) => c.verified).length, unverified: cs.filter((c) => !c.verified && !c.notReported).length, accepted: cs.filter((c) => c.userAccepted).length, notReported: cs.filter((c) => c.notReported).length },
      };
    }),
  };
}

export function appraisalDetail(projectId: string, appraisalId: string) {
  const a = db.select().from(schema.appraisals).where(eq(schema.appraisals.id, appraisalId)).get();
  if (!a) return null;
  const p = db.select().from(schema.papers).where(eq(schema.papers.id, a.paperId)).get();
  if (!p || p.projectId !== projectId) return null;
  const st = a.sourceTextId ? db.select().from(schema.sourceTexts).where(eq(schema.sourceTexts.id, a.sourceTextId)).get() : null;
  const claims = db.select().from(schema.claims).where(eq(schema.claims.appraisalId, a.id)).all();
  return { appraisal: a, paper: p, sourceText: st, claims };
}

export function synthesisView(projectId: string) {
  const topics = db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.importanceRank), asc(schema.topics.sortOrder)).all();
  const items = db.select().from(schema.synthesisItems).where(eq(schema.synthesisItems.projectId, projectId)).all();
  const cells = db.select().from(schema.matrixCells).where(eq(schema.matrixCells.projectId, projectId)).all();
  const cx = db.select().from(schema.contradictions).where(eq(schema.contradictions.projectId, projectId)).all();
  const links = db.select().from(schema.claimLinks).where(and(eq(schema.claimLinks.ownerType, "synthesis"), inArray(schema.claimLinks.ownerId, ids(items.map((i) => i.id))))).all();
  const claimIds = [...new Set([...links.map((l) => l.claimId), ...cells.flatMap((c) => c.claimIds), ...cx.flatMap((c) => c.claimIds)])];
  const claims = db.select().from(schema.claims).where(inArray(schema.claims.id, ids(claimIds))).all();
  const papers = db.select({ id: schema.papers.id, title: schema.papers.title, year: schema.papers.year, authors: schema.papers.authors }).from(schema.papers).where(inArray(schema.papers.id, ids([...new Set([...cells.map((c) => c.paperId), ...claims.map((c) => c.paperId)])]))).all();
  return {
    topics: topics.map((t) => ({
      id: t.id,
      name: t.name,
      importanceRank: t.importanceRank,
      items: items.filter((i) => i.topicId === t.id).map((i) => ({ ...i, statement: scrubIds(i.statement), claimIds: links.filter((l) => l.ownerId === i.id).map((l) => l.claimId) })),
      cells: cells.filter((c) => c.topicId === t.id).map((c) => ({ ...c, value: scrubIds(c.value) })),
      contradictions: cx.filter((c) => c.topicId === t.id).map((c) => ({ ...c, description: scrubIds(c.description) })),
    })),
    claims: Object.fromEntries(withOrdinals(claims).map((c) => [c.id, c])),
    papers: Object.fromEntries(papers.map((p) => [p.id, p])),
  };
}

export function questionsView(projectId: string) {
  const qs = db.select().from(schema.researchQuestions).where(eq(schema.researchQuestions.projectId, projectId)).orderBy(asc(schema.researchQuestions.order)).all();
  const links = db.select().from(schema.claimLinks).where(and(eq(schema.claimLinks.ownerType, "research_question"), inArray(schema.claimLinks.ownerId, ids(qs.map((q) => q.id))))).all();
  const claims = db.select().from(schema.claims).where(inArray(schema.claims.id, ids(links.map((l) => l.claimId)))).all();
  const papers = db.select({ id: schema.papers.id, title: schema.papers.title, year: schema.papers.year, authors: schema.papers.authors }).from(schema.papers).where(inArray(schema.papers.id, ids(claims.map((c) => c.paperId)))).all();
  return {
    questions: qs.map((q) => ({ ...q, text: scrubIds(q.text), gap: scrubIds(q.gap), feasibility: scrubIds(q.feasibility), weakness: scrubIds(q.weakness), design: scrubIds(q.design), structure: Object.fromEntries(Object.entries(q.structure).map(([k, v]) => [k, scrubIds(v)])), claimIds: links.filter((l) => l.ownerId === q.id).map((l) => l.claimId) })),
    claims: Object.fromEntries(withOrdinals(claims).map((c) => [c.id, c])),
    papers: Object.fromEntries(papers.map((p) => [p.id, p])),
  };
}

export function decisionLogView(projectId: string) {
  return db.select().from(schema.decisionLog).where(eq(schema.decisionLog.projectId, projectId)).orderBy(asc(schema.decisionLog.createdAt)).all();
}
