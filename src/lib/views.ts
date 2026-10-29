import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db, schema } from "./db";
import { getProject, latestJob, stageCosts } from "./project";
import { STAGES, scrubIds } from "./shared/stages";
import type { CanvasSummary, ClaimLite } from "./shared/canvas";
import { scopingState } from "./stages/scoping";

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

/** The summary table's rows, with only the fields the browser uses: the table page embeds this in its first
 *  HTML, so every unused field costs download and parse time on a phone. Exports use papersView. */
export function papersTableView(projectId: string) {
  const v = papersView(projectId);
  return {
    topics: v.topics,
    papers: v.papers.map((p) => ({
      id: p.id, title: p.title, authors: p.authors, year: p.year, journal: p.journal, citationCount: p.citationCount, oaUrl: p.oaUrl,
      sourceDatabases: p.sourceDatabases, doi: p.doi, pmid: p.pmid, openalexId: p.openalexId, hasAbstract: p.hasAbstract,
      summary: p.summary && { studyType: p.summary.studyType, setting: p.summary.setting, keyFinding: p.summary.keyFinding, edited: p.summary.edited },
      topicIds: p.topicIds,
    })),
  };
}

/** The ranking as the table shows it (see papersTableView). The per-criterion scores and rationales, most of
 *  the ranking's size, load when a row is opened (GET ranking/scores/:id); titles come from the papers. */
export function rankingTableView(projectId: string) {
  return {
    topics: rankingView(projectId).topics.map((t) => ({
      id: t.id, name: t.name, importanceRank: t.importanceRank, importanceJustification: t.importanceJustification,
      scores: t.scores.map((s) => ({ id: s.id, paperId: s.paperId, topicId: s.topicId, total: s.total, selected: s.selected, userChanged: s.userChanged, rationale: s.rationale })),
    })),
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

/** Compact summary for the canvas: one key number per node, cheap enough to stream over SSE. */
export function canvasView(projectId: string): CanvasSummary {
  const topics = db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).orderBy(asc(schema.topics.sortOrder)).all();
  const sc = scopingState(projectId);
  const qs = db.select().from(schema.queries).where(eq(schema.queries.projectId, projectId)).all();
  const runs = db.select().from(schema.searchRuns).where(eq(schema.searchRuns.projectId, projectId)).all();
  const paperIds = db.select({ id: schema.papers.id }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all().map((p) => p.id);
  const sums = db.select({ edited: schema.paperSummaries.edited }).from(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, ids(paperIds))).all();
  const scores = db.select({ topicId: schema.scores.topicId, selected: schema.scores.selected }).from(schema.scores).where(inArray(schema.scores.topicId, ids(topics.map((t) => t.id)))).all();
  const apps = db.select({ id: schema.appraisals.id, status: schema.appraisals.status, textSource: schema.appraisals.textSource }).from(schema.appraisals).where(inArray(schema.appraisals.paperId, ids(paperIds))).all();
  const cl = db.select({ verified: schema.claims.verified, notReported: schema.claims.notReported, userAccepted: schema.claims.userAccepted, userRejected: schema.claims.userRejected }).from(schema.claims).where(inArray(schema.claims.appraisalId, ids(apps.map((a) => a.id)))).all();
  const items = db.select({ kind: schema.synthesisItems.kind }).from(schema.synthesisItems).where(eq(schema.synthesisItems.projectId, projectId)).all();
  const cxCount = db.select({ id: schema.contradictions.id }).from(schema.contradictions).where(eq(schema.contradictions.projectId, projectId)).all().length;
  const rqs = db.select({ id: schema.researchQuestions.id, chosen: schema.researchQuestions.chosen, text: schema.researchQuestions.text }).from(schema.researchQuestions).where(eq(schema.researchQuestions.projectId, projectId)).all();
  const chosen = rqs.find((q) => q.chosen) ?? null;
  const perSource: CanvasSummary["retrieval"]["perSource"] = {};
  for (const r of runs) {
    const s = (perSource[r.database] ??= { fetched: 0, newUnique: 0, failed: 0 });
    s.fetched += r.fetchedCount;
    s.newUnique += r.newUniqueCount;
    if (r.status === "failed") s.failed++;
  }
  const extracted = cl.filter((c) => !c.notReported);
  return {
    topics: topics.map((t) => ({ id: t.id, name: t.name, origin: t.origin, approved: t.approved, synonyms: t.synonyms.length, controlledTerms: t.controlledTerms.length })),
    scoping: { messages: sc.messages.length, asked: sc.asked, maxQuestions: sc.maxQuestions, done: sc.done, awaitingAnswer: sc.awaitingAnswer },
    queries: qs.map((q) => ({ id: q.id, topicId: q.topicId, database: q.database, dryRunCount: q.dryRunCount, dryRunError: q.dryRunError })),
    retrieval: {
      runs: runs.length,
      done: runs.filter((r) => r.status === "done").length,
      failed: runs.filter((r) => r.status === "failed").length,
      running: runs.filter((r) => r.status === "running" || r.status === "queued").length,
      fetched: runs.reduce((a, r) => a + r.fetchedCount, 0),
      unique: paperIds.length,
      perSource,
    },
    table: { papers: paperIds.length, summarised: sums.length, edited: sums.filter((s) => s.edited).length },
    ranking: [...topics]
      .sort((a, b) => (a.importanceRank ?? 99) - (b.importanceRank ?? 99) || a.sortOrder - b.sortOrder)
      .map((t) => ({ topicId: t.id, name: t.name, importanceRank: t.importanceRank, selected: scores.filter((s) => s.topicId === t.id && s.selected).length, scored: scores.filter((s) => s.topicId === t.id).length })),
    appraisal: {
      papers: apps.length,
      done: apps.filter((a) => a.status === "done").length,
      failed: apps.filter((a) => a.status === "failed").length,
      running: apps.filter((a) => a.status === "running" || a.status === "queued").length,
      fullText: apps.filter((a) => a.textSource === "full_text").length,
      claims: extracted.length,
      verified: extracted.filter((c) => c.verified).length,
      pending: extracted.filter((c) => !c.verified && !c.userAccepted && !c.userRejected).length,
      accepted: extracted.filter((c) => !c.verified && c.userAccepted).length,
      rejected: extracted.filter((c) => !c.verified && c.userRejected).length,
      notReported: cl.length - extracted.length,
      appraisalIds: apps.map((a) => a.id),
    },
    synthesis: { statements: items.length, contradictions: cxCount, known: items.filter((i) => i.kind === "known").length, contested: items.filter((i) => i.kind === "contested").length, unknown: items.filter((i) => i.kind === "unknown").length },
    questions: { count: rqs.length, chosenId: chosen?.id ?? null, chosenText: chosen ? scrubIds(chosen.text) : null },
  };
}

/** Every extracted claim in the project, compact, for pinned Quote nodes. */
export function claimsView(projectId: string): ClaimLite[] {
  const papers = db.select({ id: schema.papers.id, title: schema.papers.title }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all();
  const apps = db.select({ id: schema.appraisals.id }).from(schema.appraisals).where(inArray(schema.appraisals.paperId, ids(papers.map((p) => p.id)))).all();
  const rows = db.select().from(schema.claims).where(and(inArray(schema.claims.appraisalId, ids(apps.map((a) => a.id))), eq(schema.claims.notReported, false))).orderBy(sql`rowid`).all();
  const title = new Map(papers.map((p) => [p.id, p.title]));
  return rows.map((c) => ({ id: c.id, appraisalId: c.appraisalId, paperId: c.paperId, paperTitle: title.get(c.paperId) ?? "", field: c.field, statement: c.statement, quote: c.quote, verified: c.verified, userAccepted: c.userAccepted, userRejected: c.userRejected }));
}
