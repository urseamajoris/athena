import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import type { Criteria } from "./db/schema";
import { getProject, HttpError, latestJob, logDecision, setStageState } from "./project";
import { STAGES } from "./shared/stages";
import { topicBlockers } from "./stages/scoping";
import { selectedPaperIds } from "./jobs/appraisal";
import { usableClaims } from "./jobs/synthesis";
import { rankingCandidates } from "./jobs/ranking";
import { startJob } from "./jobs";
import { gapOutdatedIds, synthesisSkips } from "./views";
import { nowIso } from "./util";

/*
 * Approval gates. Each stage's "definition of done" (the `done` line in STAGES) is checked against what is
 * stored, so approving a stage means its results describe the current searches, papers, selections and
 * quote decisions. Some items can be waived, but only explicitly: the researcher must tick each one, and the
 * waiver is written to the decision log.
 */

export interface Blocker {
  message: string;
  /** Set when the researcher may approve anyway after acknowledging this item. The key names exactly what is waived. */
  override?: string;
  /** "state" for blockers the approve bar already explains (upstream not approved, running, stale). */
  kind?: "state";
}

const ids = (a: string[]) => a.concat(["-"]);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const DB_LABEL: Record<string, string> = { pubmed: "PubMed", openalex: "OpenAlex" };

/** Only years and languages are sent to the databases as filters; study types and inclusion text are not. */
function sameFilters(a: Criteria | null, b: Criteria | null) {
  const norm = (c: Criteria | null) => JSON.stringify([c?.yearFrom ?? null, c?.yearTo ?? null, [...(c?.languages ?? [])].map((l) => l.toLowerCase()).sort()]);
  return norm(a) === norm(b);
}

function topicsOf(projectId: string) {
  return db.select().from(schema.topics).where(eq(schema.topics.projectId, projectId)).all();
}

function searchBlockers(projectId: string): Blocker[] {
  const topics = topicsOf(projectId);
  const qs = db.select().from(schema.queries).where(eq(schema.queries.projectId, projectId)).all();
  if (!qs.length) return [{ message: "Build the queries first." }];
  const out: Blocker[] = [];
  for (const t of topics) if (!qs.some((q) => q.topicId === t.id)) out.push({ message: `Topic “${t.name}” has no queries (it was added after the queries were built). Regenerate the queries.` });
  for (const q of qs) {
    const where = `${DB_LABEL[q.database] ?? q.database} query for “${topics.find((t) => t.id === q.topicId)?.name ?? "?"}”`;
    if (!q.dryRunAt) out.push({ message: `Dry-run the ${where}: it has not been checked since it or the criteria last changed.` });
    else if (q.dryRunError) out.push({ message: `The ${where} failed its dry run (${q.dryRunError}). Fix it, or keep it and accept that it may retrieve nothing.`, override: `dryrun:${q.id}:${q.dryRunAt}` });
    else if (q.dryRunCount === 0) out.push({ message: `The ${where} matched 0 records in its dry run. Broaden it, or keep it and accept that it adds no papers.`, override: `dryrun:${q.id}:${q.dryRunAt}` });
  }
  return out;
}

function retrievalBlockers(projectId: string): Blocker[] {
  const p = getProject(projectId);
  const runs = db.select().from(schema.searchRuns).where(eq(schema.searchRuns.projectId, projectId)).all();
  const qs = db.select().from(schema.queries).where(eq(schema.queries.projectId, projectId)).all();
  const topics = topicsOf(projectId);
  if (!runs.length) return [{ message: "Run retrieval first: no query has been run." }];
  const out: Blocker[] = [];
  if (runs.some((r) => r.status === "queued" || r.status === "running")) out.push({ message: "Wait for every query to finish." });
  if (runs.every((r) => r.status === "failed")) out.push({ message: "Every query failed, so nothing was retrieved. Check the errors and re-run retrieval." });
  const papers = db.select({ id: schema.papers.id }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all().length;
  if (!papers) out.push({ message: "Retrieval found no papers. Broaden the queries in step 3 and re-run retrieval." });
  for (const q of qs) {
    const where = `${DB_LABEL[q.database] ?? q.database} query for “${topics.find((t) => t.id === q.topicId)?.name ?? "?"}”`;
    const run = runs.find((r) => r.queryId === q.id);
    if (!run) out.push({ message: `The ${where} has not been run (it was added or rebuilt after retrieval). Re-run retrieval so the papers match the stored searches.` });
    else if (run.queryString !== q.queryString) out.push({ message: `The ${where} was edited after retrieval ran. Re-run retrieval so the papers match the stored search.` });
  }
  if (runs.some((r) => !sameFilters(r.criteria, p.criteria))) out.push({ message: "The year or language limits changed after retrieval ran. Re-run retrieval so the papers match them." });
  const failed = runs.filter((r) => r.status === "failed");
  if (failed.length && failed.length < runs.length) {
    const job = latestJob(projectId, 4);
    out.push({
      message: `${plural(failed.length, "query", "queries")} failed (${[...new Set(failed.map((r) => DB_LABEL[r.database] ?? r.database))].join(", ")}). Continue with the papers the other queries found?`,
      override: `failed-runs:${job?.id ?? "-"}:${failed.length}`,
    });
  }
  return out;
}

function summaryBlockers(projectId: string): Blocker[] {
  const papers = db.select({ id: schema.papers.id }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all().map((r) => r.id);
  if (!papers.length) return [{ message: "There are no papers to summarise. Re-run retrieval first." }];
  const have = new Set(db.select({ id: schema.paperSummaries.paperId }).from(schema.paperSummaries).where(inArray(schema.paperSummaries.paperId, ids(papers))).all().map((r) => r.id));
  const missing = papers.filter((id) => !have.has(id)).length;
  return missing ? [{ message: `${plural(missing, "paper")} ${missing === 1 ? "has" : "have"} no summary row (a batch failed or did not run). Use “Retry missing summaries” before approving.` }] : [];
}

function rankingBlockers(projectId: string): Blocker[] {
  const out: Blocker[] = [];
  const topicIds = topicsOf(projectId).map((t) => t.id);
  const scores = db.select().from(schema.scores).where(inArray(schema.scores.topicId, ids(topicIds))).all();
  for (const { topic, papers } of rankingCandidates(projectId)) {
    const ts = scores.filter((s) => s.topicId === topic.id);
    const unscored = papers.filter((p) => !ts.some((s) => s.paperId === p.id)).length;
    if (unscored) out.push({ message: `${unscored} of ${papers.length} candidate papers for “${topic.name}” could not be scored (a scoring batch failed), so its ranking is partial. Retry the unscored papers.` });
    const n = ts.filter((s) => s.selected).length;
    if (!papers.length) out.push({ message: `“${topic.name}” has no retrieved papers to rank. Broaden its query (step 3) or remove the topic (step 2).` });
    else if (n === 0) out.push({ message: `Select at least one paper for “${topic.name}”.` });
    else if (n < 3 || n > 5) out.push({ message: `“${topic.name}” has ${plural(n, "selected paper")}; the target is 3–5. Approve with ${n}?`, override: `selection:${topic.id}:${n}` });
  }
  return out;
}

function appraisalBlockers(projectId: string): Blocker[] {
  const sel = selectedPaperIds(projectId);
  if (!sel.length) return [{ message: "No papers are selected in Ranking." }];
  const papers = db.select().from(schema.papers).where(eq(schema.papers.projectId, projectId)).all();
  const apps = db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, ids(papers.map((p) => p.id)))).all();
  const title = (pid: string) => `“${(papers.find((p) => p.id === pid)?.title ?? pid).slice(0, 80)}”`;
  const out: Blocker[] = [];
  for (const pid of sel) {
    const a = apps.find((x) => x.paperId === pid);
    if (!a) out.push({ message: `${title(pid)} is selected but has not been appraised (the selection changed). Use “Update appraisals for your selection”.` });
    else if (a.status === "failed") out.push({ message: `The appraisal of ${title(pid)} failed${a.error ? ` (${a.error.slice(0, 120)})` : ""}. Re-appraise it before approving.` });
    else if (a.status !== "done") out.push({ message: `The appraisal of ${title(pid)} has not finished.` });
  }
  const extra = apps.filter((a) => !sel.includes(a.paperId));
  if (extra.length) out.push({ message: `${plural(extra.length, "appraisal")} belong${extra.length === 1 ? "s" : ""} to papers you have since deselected. Use “Update appraisals for your selection” so the review matches it.` });
  const claims = db.select().from(schema.claims).where(inArray(schema.claims.paperId, ids(sel))).all();
  const undecided = claims.filter((c) => !c.verified && !c.notReported && !c.userAccepted && !c.userRejected).length;
  if (undecided) out.push({ message: `${plural(undecided, "unverified quote")} still need${undecided === 1 ? "s" : ""} your decision: accept or reject each one.` });
  return out;
}

function synthesisBlockers(projectId: string): Blocker[] {
  const topics = topicsOf(projectId);
  const skips = synthesisSkips(projectId);
  if (topics.length && skips.size === topics.length) return [{ message: "No topic was synthesised. Check that the appraisals produced verified or accepted quotes, then re-run this step." }];
  const out: Blocker[] = [];
  for (const t of topics) {
    const s = skips.get(t.id);
    if (s) out.push({ message: `“${t.name}” has no synthesis: ${s.reason} Continue without this topic?`, override: `synthesis-skipped:${t.id}:${s.jobId ?? "-"}` });
  }
  const items = db.select({ id: schema.synthesisItems.id }).from(schema.synthesisItems).where(eq(schema.synthesisItems.projectId, projectId)).all().map((r) => r.id);
  const linked = db.select().from(schema.claimLinks).where(and(eq(schema.claimLinks.ownerType, "synthesis"), inArray(schema.claimLinks.ownerId, ids(items)))).all().map((l) => l.claimId);
  const cells = db.select().from(schema.matrixCells).where(eq(schema.matrixCells.projectId, projectId)).all().flatMap((c) => c.claimIds);
  const cx = db.select().from(schema.contradictions).where(eq(schema.contradictions.projectId, projectId)).all().flatMap((c) => c.claimIds);
  const usable = new Set(usableClaims(selectedPaperIds(projectId)).map((c) => c.id));
  const bad = [...new Set([...linked, ...cells, ...cx])].filter((id) => !usable.has(id)).length;
  if (bad) out.push({ message: `The synthesis cites ${plural(bad, "quote")} that you have since rejected, that are no longer verified, or that belong to papers no longer selected. Re-run this step.` });
  return out;
}

function questionBlockers(projectId: string): Blocker[] {
  const q = db.select().from(schema.researchQuestions).where(and(eq(schema.researchQuestions.projectId, projectId), eq(schema.researchQuestions.chosen, true))).get();
  if (!q) return [{ message: "Pick one research question first." }];
  const out: Blocker[] = [];
  if (q.noveltyStatus === "outdated") out.push({ message: "You edited the chosen question (or its novelty searches) after the novelty check ran. Re-run the novelty check so it checks the question as it now reads." });
  else if (q.noveltyStatus === "pending") out.push({ message: "The novelty check for the chosen question has not finished." });
  else if (q.noveltyStatus === "failed") out.push({ message: "The novelty searches for the chosen question failed in every database. Finish without a novelty check?", override: `novelty-failed:${q.id}` });
  if (gapOutdatedIds(projectId).has(q.id)) out.push({ message: "The gap was written for the earlier wording of the question. Edit the gap, or confirm it still applies." });
  const links = db.select().from(schema.claimLinks).where(and(eq(schema.claimLinks.ownerType, "research_question"), eq(schema.claimLinks.ownerId, q.id))).all().map((l) => l.claimId);
  const usable = new Set(usableClaims(selectedPaperIds(projectId)).map((c) => c.id));
  const bad = links.filter((id) => !usable.has(id)).length;
  if (bad) out.push({ message: `The chosen question’s gap cites ${plural(bad, "quote")} that you have since rejected or that are no longer usable. Re-run this step.` });
  return out;
}

/** Everything that stops stage `n` from being approved right now. Empty means it can be approved. */
export function approvalBlockers(projectId: string, n: number): Blocker[] {
  const def = STAGES[n - 1];
  if (!def) throw new HttpError(404, "Unknown stage");
  const p = getProject(projectId);
  const out: Blocker[] = [];
  for (let i = 1; i < n; i++) {
    if (p.stageStates[String(i)] !== "approved") {
      out.push({ message: `Approve stage ${i} (${STAGES[i - 1].title}) first.`, kind: "state" });
      break;
    }
  }
  const state = p.stageStates[String(n)];
  if (state === "running") return [...out, { message: "This stage is still running.", kind: "state" }];
  if (state === "stale") out.push({ message: "An earlier step changed after these results were produced. Re-run this step or keep the current results before approving.", kind: "state" });
  if (def.job && (state === "not_started" || state === "failed")) return [...out, { message: "Run this step (successfully) before approving it.", kind: "state" }];
  switch (n) {
    case 1:
      if (!p.idea.trim()) out.push({ message: "Write your idea first." });
      break;
    case 2:
      out.push(...topicBlockers(projectId).map((message) => ({ message })));
      break;
    case 3:
      out.push(...searchBlockers(projectId));
      break;
    case 4:
      out.push(...retrievalBlockers(projectId));
      break;
    case 5:
      out.push(...summaryBlockers(projectId));
      break;
    case 6:
      out.push(...rankingBlockers(projectId));
      break;
    case 7:
      out.push(...appraisalBlockers(projectId));
      break;
    case 8:
      out.push(...synthesisBlockers(projectId));
      break;
    case 9:
      out.push(...questionBlockers(projectId));
      break;
  }
  return out;
}

/**
 * Approve stage `n`. Fails with 409 and the outstanding blockers unless every blocker is either resolved or, where
 * allowed, explicitly waived in `overrides`. Waivers are logged with the stage approval.
 */
export function approveStage(projectId: string, n: number, overrides: string[] = []) {
  const blockers = approvalBlockers(projectId, n);
  const open = blockers.filter((b) => !b.override || !overrides.includes(b.override));
  if (open.length) throw new HttpError(409, open[0].message, { blockers: open });
  const waived = blockers.filter((b) => b.override && overrides.includes(b.override));
  if (n === 2) db.update(schema.topics).set({ approved: true }).where(eq(schema.topics.projectId, projectId)).run();
  setStageState(projectId, n, "approved", { currentStage: Math.min(9, n + 1) });
  logDecision(projectId, n, "stage_approved", null, waived.length ? { waived: waived.map((b) => ({ key: b.override, message: b.message })) } : null);
  // Kick off the next stage's background job if it has never run.
  const next = STAGES[n];
  if (next?.job && getProject(projectId).stageStates[String(next.n)] === "not_started") startJob(projectId, next.job, next.n);
  if (n === 9) db.update(schema.projects).set({ status: "complete", updatedAt: nowIso() }).where(eq(schema.projects.id, projectId)).run();
}
