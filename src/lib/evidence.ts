import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema, batchWrite } from "./db";
import { logDecision } from "./project";

const ids = (a: string[]) => a.concat(["-"]);

/**
 * Remove synthesis and research-question output that cites any of these claims. A re-run calls this BEFORE it
 * deletes the claims (directly or through the paper/appraisal cascade): synthesis items and contradictions have
 * no foreign key to papers, so without this their prose would survive while the evidence behind it vanished.
 * The removed text is kept in the decision log.
 */
export async function dropOutputCiting(projectId: string, claimIds: string[], stage: number, why: string) {
  const gone = new Set(claimIds);
  const out = { synthesisItems: 0, matrixCells: 0, contradictions: 0, questions: 0 };
  if (!gone.size) return out;
  const L = schema.claimLinks;
  const links = await db.select().from(L).where(inArray(L.claimId, ids(claimIds))).all();
  const items = await db
    .select()
    .from(schema.synthesisItems)
    .where(and(eq(schema.synthesisItems.projectId, projectId), inArray(schema.synthesisItems.id, ids(links.filter((l) => l.ownerType === "synthesis").map((l) => l.ownerId)))))
    .all();
  const qs = await db
    .select()
    .from(schema.researchQuestions)
    .where(and(eq(schema.researchQuestions.projectId, projectId), inArray(schema.researchQuestions.id, ids(links.filter((l) => l.ownerType === "research_question").map((l) => l.ownerId)))))
    .all();
  const cells = (await db.select().from(schema.matrixCells).where(eq(schema.matrixCells.projectId, projectId)).all()).filter((c) => c.claimIds.some((id) => gone.has(id)));
  const cx = (await db.select().from(schema.contradictions).where(eq(schema.contradictions.projectId, projectId)).all()).filter((c) => c.claimIds.some((id) => gone.has(id)));
  if (!items.length && !qs.length && !cells.length && !cx.length) return out;
  const owners = [...items.map((i) => i.id), ...qs.map((q) => q.id)];
  await batchWrite([
    db.delete(L).where(inArray(L.ownerId, ids(owners))),
    db.delete(schema.synthesisItems).where(inArray(schema.synthesisItems.id, ids(items.map((i) => i.id)))),
    db.delete(schema.researchQuestions).where(inArray(schema.researchQuestions.id, ids(qs.map((q) => q.id)))),
    db.delete(schema.matrixCells).where(inArray(schema.matrixCells.id, ids(cells.map((c) => c.id)))),
    db.delete(schema.contradictions).where(inArray(schema.contradictions.id, ids(cx.map((c) => c.id)))),
  ]);
  Object.assign(out, { synthesisItems: items.length, matrixCells: cells.length, contradictions: cx.length, questions: qs.length });
  await logDecision(
    projectId,
    stage,
    "evidence_dependents_removed",
    { synthesis: items.map((i) => i.statement), contradictions: cx.map((c) => c.description), questions: qs.map((q) => q.text) },
    { ...out, reason: why },
    "system",
  );
  return out;
}

/** Papers that no stored search run found: every hit they had was on a run that has since been removed. */
export async function papersWithoutHits(projectId: string) {
  const papers = await db.select().from(schema.papers).where(and(eq(schema.papers.projectId, projectId), eq(schema.papers.sourceKind, "database"))).all();
  const hit = new Set((await db.select({ id: schema.paperHits.paperId }).from(schema.paperHits).where(inArray(schema.paperHits.paperId, ids(papers.map((p) => p.id)))).all()).map((r) => r.id));
  return papers.filter((p) => !hit.has(p.id));
}

/**
 * Remove the papers that no remaining search found (their topic, and with it its queries, runs and hits, was
 * deleted). A paper another stored search still found keeps a hit and stays. Synthesis and questions citing the
 * removed papers go first, and what is removed, including summary cells the researcher corrected, is logged.
 */
export async function dropPapersWithoutHits(projectId: string, stage: number, why: string): Promise<number> {
  const gone = await papersWithoutHits(projectId);
  if (!gone.length) return 0;
  const pids = gone.map((p) => p.id);
  await dropOutputCiting(projectId, (await db.select({ id: schema.claims.id }).from(schema.claims).where(inArray(schema.claims.paperId, pids)).all()).map((r) => r.id), stage, why);
  const corrected = (await db.select().from(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, pids)).all()).filter((s) => s.edited);
  await logDecision(
    projectId,
    stage,
    "papers_removed_no_search",
    {
      papers: gone.map((p) => ({ id: p.id, title: p.title, doi: p.doi, pmid: p.pmid })),
      correctedSummaries: corrected.map((s) => ({ paperId: s.paperId, studyType: s.studyType, setting: s.setting, keyFinding: s.keyFinding })),
    },
    { removed: gone.length, reason: why },
    "system",
  );
  await db.delete(schema.papers).where(inArray(schema.papers.id, pids)).run();
  return gone.length;
}

/** Claims of the given appraisals (used before those appraisals are deleted). */
export async function claimIdsOfAppraisals(appraisalIds: string[]): Promise<string[]> {
  return (await db.select({ id: schema.claims.id }).from(schema.claims).where(inArray(schema.claims.appraisalId, ids(appraisalIds))).all()).map((r) => r.id);
}

/** Every claim of a project's papers. */
export async function claimIdsOfProject(projectId: string): Promise<string[]> {
  const pids = (await db.select({ id: schema.papers.id }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all()).map((r) => r.id);
  return (await db.select({ id: schema.claims.id }).from(schema.claims).where(inArray(schema.claims.paperId, ids(pids))).all()).map((r) => r.id);
}
