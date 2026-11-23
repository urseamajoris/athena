import "./testing/env";
import { test } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { db, schema } from "./db";
import { config } from "./config";
import { approvalBlockers, approveStage } from "./gates";
import { HttpError } from "./project";
import { dispatch } from "./api";
import { startJob, cancelStage } from "./jobs";
import { synthesisJob } from "./jobs/synthesis";
import { summariesJob } from "./jobs/summaries";
import { appraisalJob } from "./jobs/appraisal";
import type { JobContext } from "./jobs/runner";
import { adapters } from "./sources";
import { markdownReport, summaryCsv } from "./export";
import { questionsView, rankingView, retrievalView, synthesisView } from "./views";
import { RERUN_REPLACES, STAGES } from "./shared/stages";
import { limiter, newId } from "./util";
import { ABSTRACT, seedReview, setStates, settleJobs, stateOf, type Seeded } from "./testing/seed";

/*
 * A stage can be approved, and the report downloaded as final, only while it still describes the searches,
 * papers, selections and quote decisions that are stored. Each test breaks one of those and checks what the
 * shipped gate, job or route does, in a throwaway database with MOCK_MODE.
 */

/** Stages before n approved, n and later "needs review" (so approving n does not auto-start the next job). */
async function atStage(projectId: string, n: number) {
  await setStates(projectId, Object.fromEntries(STAGES.map((s) => [String(s.n), s.n < n ? "approved" : "needs_review"])), { status: "active" });
}
async function blocks(projectId: string, n: number, pattern: RegExp, overrides: string[] = []) {
  await assert.rejects(
    async () => approveStage(projectId, n, overrides),
    (e: unknown) => e instanceof HttpError && e.status === 409 && pattern.test(e.message),
    `stage ${n} should be blocked by ${pattern}`,
  );
  assert.notEqual(await stateOf(projectId, n), "approved");
}
async function overrideFor(projectId: string, n: number, pattern: RegExp) {
  const b = (await approvalBlockers(projectId, n)).find((x) => pattern.test(x.message));
  assert.ok(b, `expected a blocker matching ${pattern}`);
  assert.ok(b.override, `blocker "${b.message}" should be waivable`);
  return b.override!;
}
async function call(s: { projectId: string }, method: string, path: string, body?: unknown) {
  const res = await dispatch(new Request(`http://test/api/projects/${s.projectId}/${path}`, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) }), s.projectId, path.split("/"));
  return { status: res.status, data: await res.json() };
}
const logged = (projectId: string, action: string) => db.select().from(schema.decisionLog).where(and(eq(schema.decisionLog.projectId, projectId), eq(schema.decisionLog.action, action))).all();
const latestJob = async (projectId: string, stage: number) => (await db.select().from(schema.jobs).where(and(eq(schema.jobs.projectId, projectId), eq(schema.jobs.stage, stage))).all()).pop()!;

/**
 * Make every model call fail while `fn` runs. With the mock responder off, the client needs an API key before it
 * can send anything; the test environment has none, so the call throws without any request leaving the process.
 */
async function withFailingAi<T>(fn: () => Promise<T>): Promise<T> {
  assert.equal(config.xaiApiKey, "", "tests must never hold a real API key");
  config.mockAi = false;
  try {
    return await fn();
  } finally {
    config.mockAi = true;
  }
}

/** A job context whose run is cancelled once the handler has started (after its first progress report). */
function cancelledAfterStart(projectId: string, params: Record<string, unknown> = {}): JobContext {
  let started = false;
  return {
    jobId: newId("job"),
    projectId,
    params,
    progress: async () => {
      started = true;
    },
    log: async () => {},
    cancelled: async () => started,
  };
}

/** A second topic with its own PubMed query and finished search run. */
async function addTopic(s: Seeded, name: string) {
  const topicId = newId("t");
  await db.insert(schema.topics).values({ id: topicId, projectId: s.projectId, name, synonyms: ["policy"], approved: true, sortOrder: 1 }).run();
  const queryId = newId("q");
  const qs = "telemedicine[tiab] AND policy[tiab]";
  await db.insert(schema.queries).values({ id: queryId, projectId: s.projectId, topicId, database: "pubmed", queryString: qs, aiQueryString: qs, dryRunCount: 30, dryRunAt: "2026-11-01T00:00:00.000Z" }).run();
  const runId = newId("run");
  const criteria = (await db.select().from(schema.projects).where(eq(schema.projects.id, s.projectId)).get())!.criteria;
  await db.insert(schema.searchRuns).values({ id: runId, projectId: s.projectId, queryId, database: "pubmed", queryString: qs, criteria, status: "done", resultCount: 30, fetchedCount: 2, newUniqueCount: 1, cap: 40, order: 2 }).run();
  return { topicId, queryId, runId };
}
/** Link an existing paper to a topic as found by that topic's run, scored for it, and (optionally) selected. */
async function linkPaper(paperId: string, t: { topicId: string; runId: string }, selected: boolean, rank = 0) {
  await db.insert(schema.paperTopics).values({ paperId, topicId: t.topicId }).run();
  await db.insert(schema.paperHits).values({ paperId, searchRunId: t.runId, rank }).run();
  const id = newId("sc");
  await db.insert(schema.scores).values({ id, paperId, topicId: t.topicId, subScores: { topicFit: 4, designStrength: 3, settingMatch: 4, recency: 4, citationImpact: 2 }, rationales: { topicFit: "", designStrength: "", settingMatch: "", recency: "", citationImpact: "" }, total: 70, rationale: "Relevant", selected }).run();
  return id;
}
/** A new retrieved paper with a summary, found only by the given run. Optionally appraised with one verified quote. */
async function addPaper(s: Seeded, t: { topicId: string; runId: string }, title: string, opts: { rank?: number; score?: boolean; selected?: boolean; statement?: string } = {}) {
  const id = newId("p");
  await db.insert(schema.papers).values({ id, projectId: s.projectId, doi: `10.1000/${id}`, title, normTitle: title.toLowerCase(), authors: ["Tran B"], year: 2022, abstract: ABSTRACT, sourceDatabases: ["pubmed"] }).run();
  await db.insert(schema.paperTopics).values({ paperId: id, topicId: t.topicId }).run();
  await db.insert(schema.paperHits).values({ paperId: id, searchRunId: t.runId, rank: opts.rank ?? 0 }).run();
  await db.insert(schema.paperSummaries).values({ id: `s_${id}`, paperId: id, studyType: "cross_sectional", setting: "Rural Thailand", keyFinding: "Uptake rose.", model: "mock:grok" }).run();
  if (opts.score ?? true) {
    await db.insert(schema.scores).values({ id: newId("sc"), paperId: id, topicId: t.topicId, subScores: { topicFit: 3, designStrength: 3, settingMatch: 4, recency: 4, citationImpact: 2 }, rationales: { topicFit: "", designStrength: "", settingMatch: "", recency: "", citationImpact: "" }, total: 60, rationale: "Relevant", selected: !!opts.selected }).run();
  }
  let claimId: string | null = null;
  if (opts.statement !== undefined) {
    const stId = newId("st");
    await db.insert(schema.sourceTexts).values({ id: stId, paperId: id, kind: "abstract", source: "pubmed", text: ABSTRACT, fullLength: ABSTRACT.length }).run();
    const appraisalId = newId("ap");
    await db.insert(schema.appraisals).values({ id: appraisalId, paperId: id, sourceTextId: stId, textSource: "abstract", templateType: "cross_sectional", status: "done", checklist: [] }).run();
    claimId = newId("c");
    await db.insert(schema.claims).values({ id: claimId, appraisalId, paperId: id, field: "key_findings", statement: opts.statement, quote: "Uptake of teleconsultation rose sharply in rural districts", verified: true }).run();
  }
  return { id, claimId };
}

// ---------- 1. synthesis is checked against each topic's own selection ----------

test("stage 8: a paper deselected in one topic but still selected in another cannot stay cited in the first topic's synthesis", async () => {
  const s = await seedReview();
  const b = await addTopic(s, "Policy and regulation");
  await linkPaper(s.paperIds[0], b, true); // paper 0 is selected under both topics

  // The researcher removes paper 0 from "Telemedicine adoption" only, then re-approves ranking and appraisal
  // (paper 0 is still selected, under the other topic, so its appraisal stands) and keeps the stale synthesis.
  assert.equal((await call(s, "POST", "ranking/select", { scoreId: s.scoreIds[0], selected: false })).status, 200);
  assert.equal(await stateOf(s.projectId, 8), "stale");
  assert.equal((await call(s, "POST", "stages/6/approve", { overrides: [await overrideFor(s.projectId, 6, /Policy and regulation.* has 1 selected paper/)] })).status, 200);
  assert.equal((await call(s, "POST", "stages/7/keep", {})).status, 200);
  assert.equal((await call(s, "POST", "stages/7/approve", {})).status, 200);
  assert.equal((await call(s, "POST", "stages/8/keep", {})).status, 200);

  const skip = await overrideFor(s.projectId, 8, /Policy and regulation.* has no synthesis/);
  const res = await call(s, "POST", "stages/8/approve", { overrides: [skip] });
  assert.equal(res.status, 409, "the synthesis still cites paper 0 under the topic it was removed from");
  // Its two statements and its matrix cell cite paper 0's key finding; the contradiction cites its checklist quote.
  assert.match(res.data.error, /synthesis for “Telemedicine adoption” cites 2 quotes .* no longer selected for this topic/);
  assert.equal(res.data.blockers.every((x: { override?: string }) => !x.override), true, "citing an unselected paper cannot be waived");
  assert.notEqual(await stateOf(s.projectId, 8), "approved");

  // Selecting it for that topic again makes the stored synthesis describe the selection once more.
  await db.update(schema.scores).set({ selected: true }).where(eq(schema.scores.id, s.scoreIds[0])).run();
  await atStage(s.projectId, 8);
  assert.deepEqual((await approvalBlockers(s.projectId, 8)).map((x) => x.override), [skip]);
});

test("stage 8: quotes of an excluded paper still block, per topic", async () => {
  const s = await seedReview();
  await atStage(s.projectId, 8);
  await db.update(schema.papers).set({ excluded: true, excludedReason: "Protocol" }).where(eq(schema.papers.id, s.paperIds[1])).run();
  await blocks(s.projectId, 8, /synthesis for “Telemedicine adoption” cites 2 quotes/);
});

test("stage 8: a matrix cell for a paper no longer selected for the topic blocks even when it cites no quote", async () => {
  const s = await seedReview();
  await atStage(s.projectId, 8);
  await db.update(schema.scores).set({ selected: false, userChanged: true }).where(eq(schema.scores.id, s.scoreIds[3])).run();
  // Nothing cites paper 3's quotes any more; only its matrix cell still stands for it under this topic.
  await db.delete(schema.claimLinks).where(inArray(schema.claimLinks.claimId, s.claimIds[3])).run();
  await db.update(schema.matrixCells).set({ claimIds: [] }).where(eq(schema.matrixCells.id, s.cellIds[3])).run();
  await blocks(s.projectId, 8, /synthesis for “Telemedicine adoption” still covers 1 paper no longer selected for this topic/);
});

// ---------- 2. papers no stored search found ----------

test("deleting a topic removes the papers only its searches found and keeps papers another search still found", async () => {
  const s = await seedReview();
  const b = await addTopic(s, "Policy and regulation");
  await linkPaper(s.paperIds[0], b, false, 1); // also found by a "Telemedicine adoption" query: must stay
  const only = await addPaper(s, b, "Telehealth reimbursement policy in Malaysia", { statement: "Reimbursement drove uptake." });
  await call(s, "PATCH", `papers/${only.id}/summary`, { setting: "Urban Malaysia" });

  assert.equal((await call(s, "DELETE", `topics/${b.topicId}`)).status, 200);
  const left = (await db.select({ id: schema.papers.id }).from(schema.papers).where(eq(schema.papers.projectId, s.projectId)).all()).map((r) => r.id);
  assert.deepEqual([...left].sort(), [...s.paperIds].sort(), "the paper no remaining search found is gone; the shared paper stays");
  const log = await logged(s.projectId, "papers_removed_no_search");
  assert.equal(log.length, 1);
  const before = log[0].before as { papers: { title: string }[]; correctedSummaries: { setting: string }[] };
  assert.deepEqual(before.papers.map((x) => x.title), ["Telehealth reimbursement policy in Malaysia"]);
  assert.deepEqual(before.correctedSummaries.map((x) => x.setting), ["Urban Malaysia"], "a corrected summary cell is kept in the log");

  // Keep and approve the stale steps: retrieval and the summary table now count only what the stored searches found.
  assert.equal((await call(s, "POST", "stages/2/approve", {})).status, 200);
  for (const n of [3, 4, 5]) {
    assert.equal((await call(s, "POST", `stages/${n}/keep`, {})).status, 200);
    if (n === 4) assert.equal((await retrievalView(s.projectId)).uniquePapers, 4);
    assert.equal((await call(s, "POST", `stages/${n}/approve`, {})).status, 200, `stage ${n}`);
  }
  assert.ok(!(await summaryCsv(s.projectId)).includes("Telehealth reimbursement policy in Malaysia"));
});

test("stages 4 and 5: a stored paper that no stored search found blocks approval", async () => {
  const s = await seedReview();
  await db.delete(schema.paperHits).where(eq(schema.paperHits.paperId, s.paperIds[3])).run(); // as if the run that found it was removed
  await atStage(s.projectId, 4);
  await blocks(s.projectId, 4, /1 paper was not found by any search that is still stored/);
  await atStage(s.projectId, 5);
  await blocks(s.projectId, 5, /1 paper was not found by any search that is still stored/);
  assert.ok((await approvalBlockers(s.projectId, 5)).every((x) => !x.override));
});

// ---------- 3. novelty searches written for an earlier wording ----------

test("stage 9: re-running the stored novelty searches does not clear the check until they are rewritten for the edited question", async () => {
  const s = await seedReview();
  await atStage(s.projectId, 9);
  const chosen = (d: { questions: { id: string; noveltyStatus: string; noveltySearchesOutdated: boolean; gapOutdated: boolean; noveltyQueries: { query: string }[] }[] }) => d.questions.find((x) => x.id === s.questionId)!;
  let q = chosen((await call(s, "PATCH", `questions/${s.questionId}`, { text: "Among rural clinics in Vietnam, does connectivity investment increase uptake?" })).data);
  assert.deepEqual([q.noveltyStatus, q.noveltySearchesOutdated], ["outdated", true]);
  await call(s, "POST", `questions/${s.questionId}/gap-confirm`, {});

  // The re-run executes the strings written for the old wording, so it cannot say the new wording was checked.
  q = chosen((await call(s, "POST", `questions/${s.questionId}/novelty`, {})).data);
  assert.equal(q.noveltyQueries[0].query, "telemedicine AND connectivity", "the stored string is unchanged");
  assert.deepEqual([q.noveltyStatus, q.noveltySearchesOutdated], ["outdated", true]);
  await blocks(s.projectId, 9, /still search for the earlier wording/);
  assert.match(await markdownReport(s.projectId), /OUT OF DATE: these searches were written for an earlier wording/);

  // Rewriting the searches for the new wording is not enough on its own: they have to be run.
  q = chosen((await call(s, "PATCH", `questions/${s.questionId}`, { noveltyQueries: [{ database: "pubmed", query: "telemedicine AND connectivity AND Vietnam" }] })).data);
  assert.deepEqual([q.noveltyStatus, q.noveltySearchesOutdated], ["outdated", false]);
  await blocks(s.projectId, 9, /edited the chosen question’s novelty searches after the novelty check ran/);
  q = chosen((await call(s, "POST", `questions/${s.questionId}/novelty`, {})).data);
  assert.notEqual(q.noveltyStatus, "outdated");
  assert.deepEqual(await approvalBlockers(s.projectId, 9), []);
});

// ---------- 4. design and structure edits count as question edits ----------

test("stage 9: a design-only or structure-only save outdates the novelty check and the gap, like a text edit", async () => {
  const s = await seedReview();
  await atStage(s.projectId, 9);
  const chosen = (d: { questions: { id: string; noveltyStatus: string; noveltySearchesOutdated: boolean; gapOutdated: boolean }[] }) => d.questions.find((x) => x.id === s.questionId)!;
  const stored = (await db.select().from(schema.researchQuestions).where(eq(schema.researchQuestions.id, s.questionId)).get())!;

  // Saving the editor unchanged is not an edit.
  let q = chosen((await call(s, "PATCH", `questions/${s.questionId}`, { text: stored.text, structure: stored.structure, design: stored.design, gap: stored.gap })).data);
  assert.deepEqual([q.noveltyStatus, q.gapOutdated], ["done", false]);

  q = chosen((await call(s, "PATCH", `questions/${s.questionId}`, { design: "Stepped-wedge trial" })).data);
  assert.deepEqual([q.noveltyStatus, q.noveltySearchesOutdated, q.gapOutdated], ["outdated", true, true]);
  assert.ok((await approvalBlockers(s.projectId, 9)).some((x) => /gap was written for the earlier version/.test(x.message)));
  q = chosen((await call(s, "POST", `questions/${s.questionId}/gap-confirm`, {})).data);
  assert.equal(q.gapOutdated, false);

  q = chosen((await call(s, "PATCH", `questions/${s.questionId}`, { structure: { ...stored.structure, Population: "Rural clinics in Vietnam" } })).data);
  assert.deepEqual([q.noveltyStatus, q.gapOutdated], ["outdated", true], "a structure-only save needs the gap re-checked");

  // Editing the gap in the same save as the design change is the re-check.
  q = chosen((await call(s, "PATCH", `questions/${s.questionId}`, { design: "Cohort study", gap: "No study has followed clinics after connectivity investment." })).data);
  assert.deepEqual([q.noveltyStatus, q.gapOutdated], ["outdated", false]);
  await blocks(s.projectId, 9, /still search for the earlier wording/);
});

// ---------- 5. a retry never re-selects what the researcher cleared ----------

test("retrying unscored papers does not re-select papers the researcher deselected", async () => {
  const s = await seedReview();
  for (const scoreId of s.scoreIds.slice(0, 3)) assert.equal((await call(s, "POST", "ranking/select", { scoreId, selected: false })).status, 200);
  await db.delete(schema.scores).where(eq(schema.scores.id, s.scoreIds[3])).run(); // its scoring batch had failed
  await startJob(s.projectId, "ranking", 6, { retryMissing: true });
  await settleJobs(s.projectId);
  const scores = await db.select().from(schema.scores).where(eq(schema.scores.topicId, s.topicId)).all();
  assert.equal(scores.length, 4, "the missing paper was scored");
  assert.deepEqual(scores.filter((x) => x.selected).map((x) => x.paperId), [], "the cleared selection stays cleared");
  await atStage(s.projectId, 6);
  await blocks(s.projectId, 6, /Select at least one paper/);
});

test("retrying unscored papers still gives a default pick to a topic that never had a selection", async () => {
  const s = await seedReview();
  await db.update(schema.scores).set({ selected: false }).where(inArray(schema.scores.id, s.scoreIds)).run(); // never selected, never changed
  await db.delete(schema.scores).where(eq(schema.scores.id, s.scoreIds[3])).run();
  await startJob(s.projectId, "ranking", 6, { retryMissing: true });
  await settleJobs(s.projectId);
  const scores = await db.select().from(schema.scores).where(eq(schema.scores.topicId, s.topicId)).all();
  assert.equal(scores.filter((x) => x.selected).length, 4);
});

// ---------- 6. the per-topic scoring limit ----------

test("stage 6: papers left unscored by the per-topic limit are shown and must be accepted before approval", async () => {
  const s = await seedReview();
  const a = { topicId: s.topicId, runId: s.runIds[0] };
  // 61 papers found for the topic: the 60 best-ranked are scored, the 61st is past the limit.
  for (let i = 4; i < 61; i++) await addPaper(s, a, `Telemedicine study ${i}`, { rank: i, score: i < 60 });
  const t = (await rankingView(s.projectId)).topics[0];
  assert.deepEqual([t.scores.length, t.candidates, t.unscored, t.linked, t.notScoredOverLimit], [60, 60, 0, 61, 1]);

  await atStage(s.projectId, 6);
  await blocks(s.projectId, 6, /1 of the 61 papers found for “Telemedicine adoption” were not scored: only the 60/);
  const waive = await overrideFor(s.projectId, 6, /were not scored/);
  assert.match(await markdownReport(s.projectId), /60 of the 61 papers found for this topic were scored; 1 were not/);
  assert.equal((await call(s, "POST", "stages/6/approve", { overrides: [waive] })).status, 200);
  const approved = (await logged(s.projectId, "stage_approved")).pop()!;
  assert.deepEqual((approved.after as { waived: { key: string }[] }).waived.map((w) => w.key), [waive], "the accepted limit is logged");

  // Once the paper is scored there is nothing to accept.
  await atStage(s.projectId, 6);
  const last = (await db.select().from(schema.papers).where(and(eq(schema.papers.projectId, s.projectId), eq(schema.papers.title, "Telemedicine study 60"))).get())!;
  await db.insert(schema.scores).values({ id: newId("sc"), paperId: last.id, topicId: s.topicId, subScores: { topicFit: 3, designStrength: 3, settingMatch: 4, recency: 4, citationImpact: 2 }, rationales: { topicFit: "", designStrength: "", settingMatch: "", recency: "", citationImpact: "" }, total: 50, rationale: "Relevant" }).run();
  assert.deepEqual(await approvalBlockers(s.projectId, 6), []);
});

// ---------- 7. synthesis and questions survive a failed or cancelled re-run ----------

const EDITED = "Known: rural uptake rose where clinics had stable connectivity.";
async function editSynthesis(s: Seeded) {
  assert.equal((await call(s, "PATCH", `synthesis/${s.synthesisIds[0]}`, { statement: EDITED })).status, 200);
}
const statements = async (projectId: string) => (await synthesisView(projectId)).topics.flatMap((t) => t.items.map((i) => i.statement));

test("a synthesis re-run that fails keeps the previous synthesis, edited statements included", async () => {
  const s = await seedReview();
  await editSynthesis(s);
  await withFailingAi(async () => {
    await startJob(s.projectId, "synthesis", 8);
    await settleJobs(s.projectId);
  });
  assert.equal((await latestJob(s.projectId, 8)).status, "failed");
  assert.equal(await stateOf(s.projectId, 8), "failed");
  assert.equal((await statements(s.projectId)).length, 2, "the step is not left empty");
  assert.ok((await statements(s.projectId)).includes(EDITED));
  const v = (await synthesisView(s.projectId)).topics[0];
  assert.deepEqual([v.cells.length, v.contradictions.length, v.skipped], [4, 1, null]);
});

test("a synthesis re-run cancelled after it started keeps the previous synthesis", async () => {
  const s = await seedReview();
  await editSynthesis(s);
  await synthesisJob(cancelledAfterStart(s.projectId));
  assert.ok((await statements(s.projectId)).includes(EDITED));
  assert.equal((await synthesisView(s.projectId)).topics[0].cells.length, 4);
});

test("a successful synthesis re-run replaces the synthesis and writes the previous text to the decision log first", async () => {
  const s = await seedReview();
  await editSynthesis(s);
  await startJob(s.projectId, "synthesis", 8);
  await settleJobs(s.projectId);
  assert.equal((await latestJob(s.projectId, 8)).status, "done");
  assert.ok(!(await statements(s.projectId)).includes(EDITED));
  assert.ok((await statements(s.projectId)).every((x) => x.startsWith("(mock)")));
  const log = await logged(s.projectId, "synthesis_replaced");
  assert.equal(log.length, 1);
  const before = log[0].before as { topic: string; statements: { statement: string; edited: boolean }[]; contradictions: string[] }[];
  assert.deepEqual(before[0].statements.find((x) => x.edited)?.statement, EDITED);
  assert.deepEqual(before[0].contradictions, ["Papers disagree on connectivity."]);
});

test("stage 8: a topic whose re-run failed keeps its earlier synthesis, and keeping it has to be acknowledged", async () => {
  const s = await seedReview();
  const b = await addTopic(s, "Policy and regulation");
  // Two selected, appraised papers for the second topic. Their extracted statements are blank, which the
  // synthesis output check rejects, so the AI call for this topic fails while the first topic's succeeds.
  const p1 = await addPaper(s, b, "Telehealth policy in Vietnam", { selected: true, statement: " " });
  const p2 = await addPaper(s, b, "Telehealth regulation in Laos", { selected: true, statement: " ", rank: 1 });
  const earlier = newId("sy");
  await db.insert(schema.synthesisItems).values({ id: earlier, projectId: s.projectId, topicId: b.topicId, kind: "known", statement: "Known: policy shapes uptake.", edited: true }).run();
  for (const p of [p1, p2]) await db.insert(schema.claimLinks).values({ ownerType: "synthesis", ownerId: earlier, claimId: p.claimId! }).run();

  await startJob(s.projectId, "synthesis", 8);
  await settleJobs(s.projectId);
  assert.equal((await latestJob(s.projectId, 8)).status, "done");
  const view = await synthesisView(s.projectId);
  const tb = view.topics.find((t) => t.id === b.topicId)!;
  assert.deepEqual(tb.items.map((i) => i.statement), ["Known: policy shapes uptake."], "the failed topic still shows its earlier text");
  assert.match(tb.keptFromEarlierRun ?? "", /AI synthesis for this topic failed/);
  assert.ok(view.topics.find((t) => t.id === s.topicId)!.items.every((i) => i.statement.startsWith("(mock)")), "the other topic was replaced");

  await atStage(s.projectId, 8);
  await blocks(s.projectId, 8, /“Policy and regulation” still shows the synthesis from an earlier run/);
  await approveStage(s.projectId, 8, [await overrideFor(s.projectId, 8, /earlier run/)]);
  assert.equal(await stateOf(s.projectId, 8), "approved");
});

const questionTexts = async (projectId: string) => (await questionsView(projectId)).questions.map((q) => q.text);

test("a questions re-run that fails keeps the previous questions and the chosen one", async () => {
  const s = await seedReview();
  await call(s, "PATCH", `questions/${s.questionId}`, { text: "Among rural clinics in Vietnam, does connectivity investment increase uptake?" });
  await withFailingAi(async () => {
    await startJob(s.projectId, "questions", 9);
    await settleJobs(s.projectId);
  });
  assert.equal((await latestJob(s.projectId, 9)).status, "failed");
  assert.equal(await stateOf(s.projectId, 9), "failed");
  const qs = (await questionsView(s.projectId)).questions;
  assert.deepEqual(qs.map((q) => [q.id, q.text, q.chosen]), [[s.questionId, "Among rural clinics in Vietnam, does connectivity investment increase uptake?", true]]);
  assert.equal(qs[0].claimIds.length, 1, "its evidence links are intact");
});

test("a questions re-run cancelled during its novelty searches keeps the previous questions", async () => {
  const s = await seedReview();
  const orig = adapters.pubmed.search;
  let cancelled = 0;
  adapters.pubmed.search = async (q, c, cap, o) => {
    if (!cancelled) cancelled = await cancelStage(s.projectId, 9); // the researcher presses Cancel while the job is searching
    return orig.call(adapters.pubmed, q, c, cap, o);
  };
  try {
    await startJob(s.projectId, "questions", 9);
    await settleJobs(s.projectId);
    await new Promise((r) => setTimeout(r, 50)); // let the cancelled handler return
  } finally {
    adapters.pubmed.search = orig;
  }
  assert.equal(cancelled, 1, "the job was running when it was cancelled");
  assert.equal((await latestJob(s.projectId, 9)).status, "cancelled");
  assert.deepEqual((await questionsView(s.projectId)).questions.map((q) => [q.id, q.chosen]), [[s.questionId, true]]);
});

test("a successful questions re-run replaces the questions and writes the previous text to the decision log first", async () => {
  const s = await seedReview();
  const old = (await questionTexts(s.projectId))[0];
  await startJob(s.projectId, "questions", 9);
  await settleJobs(s.projectId);
  assert.equal((await latestJob(s.projectId, 9)).status, "done");
  const now = (await questionsView(s.projectId)).questions;
  assert.equal(now.length, 3);
  assert.ok(now.every((q) => q.id !== s.questionId && q.noveltyStatus !== "pending" && q.claimIds.length > 0));
  const log = await logged(s.projectId, "questions_replaced");
  assert.equal(log.length, 1);
  assert.deepEqual((log[0].before as { text: string; chosen: boolean }[]).map((q) => [q.text, q.chosen]), [[old, true]]);
});

// ---------- 8. a full re-run of summaries or appraisals ----------

async function correctSummary(s: Seeded) {
  const r = await call(s, "PATCH", `papers/${s.paperIds[0]}/summary`, { setting: "Rural Vietnam" });
  assert.equal(r.data.changed, true);
}
const summaryOf = (paperId: string) => db.select().from(schema.paperSummaries).where(eq(schema.paperSummaries.paperId, paperId)).get();
async function summaryCount(ids: string[]) {
  return (await Promise.all(ids.map((id) => summaryOf(id)))).filter((row) => row != null).length;
}

test("a full summaries re-run that fails keeps every summary, corrected cells included", async () => {
  const s = await seedReview();
  await correctSummary(s);
  await withFailingAi(async () => {
    await startJob(s.projectId, "summaries", 5, { force: true });
    await settleJobs(s.projectId);
  });
  assert.equal((await latestJob(s.projectId, 5)).status, "failed");
  assert.deepEqual([(await summaryOf(s.paperIds[0]))?.setting, (await summaryOf(s.paperIds[0]))?.edited], ["Rural Vietnam", true]);
  assert.equal(await summaryCount(s.paperIds), 4);
});

test("a full summaries re-run cancelled after it started keeps every summary, corrected cells included", async () => {
  const s = await seedReview();
  await correctSummary(s);
  await summariesJob(cancelledAfterStart(s.projectId, { force: true }));
  assert.deepEqual([(await summaryOf(s.paperIds[0]))?.setting, (await summaryOf(s.paperIds[0]))?.edited], ["Rural Vietnam", true]);
  assert.equal(await summaryCount(s.paperIds), 4);
});

test("a successful full summaries re-run replaces corrected cells and writes the corrected text to the decision log first", async () => {
  const s = await seedReview();
  await correctSummary(s);
  await startJob(s.projectId, "summaries", 5, { force: true });
  await settleJobs(s.projectId);
  assert.equal((await latestJob(s.projectId, 5)).status, "done");
  assert.equal((await summaryOf(s.paperIds[0]))?.edited, false);
  assert.notEqual((await summaryOf(s.paperIds[0]))?.setting, "Rural Vietnam");
  assert.equal(await summaryCount(s.paperIds), 4);
  const log = await logged(s.projectId, "summaries_replaced");
  assert.equal(log.length, 1);
  assert.deepEqual((log[0].before as { paperId: string; setting: string }[]).map((x) => [x.paperId, x.setting]), [[s.paperIds[0], "Rural Vietnam"]]);
});

test("“Retry missing summaries” fills only the missing rows and leaves existing ones, corrected or not, alone", async () => {
  const s = await seedReview();
  await correctSummary(s);
  const untouched = (await summaryOf(s.paperIds[1]))!;
  await db.delete(schema.paperSummaries).where(eq(schema.paperSummaries.paperId, s.paperIds[2])).run();
  await startJob(s.projectId, "summaries", 5, {});
  await settleJobs(s.projectId);
  assert.deepEqual([(await summaryOf(s.paperIds[0]))?.setting, (await summaryOf(s.paperIds[0]))?.edited], ["Rural Vietnam", true]);
  assert.deepEqual(await summaryOf(s.paperIds[1]), untouched);
  assert.ok(await summaryOf(s.paperIds[2]), "the missing row was filled");
  assert.equal((await logged(s.projectId, "summaries_replaced")).length, 0);
});

/** The researcher accepts an unverified quote of paper 0 and rejects one of paper 1. */
async function decideQuotes(s: Seeded) {
  const [accepted, rejected] = [s.claimIds[0][1], s.claimIds[1][1]];
  await db.update(schema.claims).set({ verified: false }).where(inArray(schema.claims.id, [accepted, rejected])).run();
  assert.equal((await call(s, "PATCH", `claims/${accepted}`, { decision: "accept" })).status, 200);
  assert.equal((await call(s, "PATCH", `claims/${rejected}`, { decision: "reject" })).status, 200);
  return { accepted, rejected };
}
const decisions = async (projectId: string) => {
  const pids = (await db.select({ id: schema.papers.id }).from(schema.papers).where(eq(schema.papers.projectId, projectId)).all()).map((r) => r.id);
  return (await db.select().from(schema.claims).where(inArray(schema.claims.paperId, pids)).all()).filter((c) => c.userAccepted || c.userRejected).map((c) => c.id).sort();
};

test("a full appraisal re-run that fails keeps every appraisal and quote decision, and the synthesis citing them", async () => {
  const s = await seedReview();
  const d = await decideQuotes(s);
  await withFailingAi(async () => {
    await startJob(s.projectId, "appraisal", 7, { force: true });
    await settleJobs(s.projectId);
  });
  assert.equal((await latestJob(s.projectId, 7)).status, "failed");
  assert.equal(await stateOf(s.projectId, 7), "failed");
  assert.deepEqual(await decisions(s.projectId), [d.accepted, d.rejected].sort());
  const apps = await db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, s.paperIds)).all();
  assert.deepEqual(apps.map((a) => [a.id, a.status]).sort(), s.appraisalIds.map((id) => [id, "done"]).sort());
  assert.equal((await statements(s.projectId)).length, 2, "nothing that cites the kept quotes was removed");
});

test("a full appraisal re-run cancelled after it started keeps every appraisal and quote decision", async () => {
  const s = await seedReview();
  const d = await decideQuotes(s);
  await appraisalJob(cancelledAfterStart(s.projectId, { force: true }));
  assert.deepEqual(await decisions(s.projectId), [d.accepted, d.rejected].sort());
  assert.deepEqual((await db.select({ id: schema.appraisals.id }).from(schema.appraisals).where(inArray(schema.appraisals.paperId, s.paperIds)).all()).map((a) => a.id).sort(), [...s.appraisalIds].sort());
  assert.equal((await statements(s.projectId)).length, 2);
});

test("a successful full appraisal re-run replaces the appraisals and writes the previous quote decisions to the decision log first", async () => {
  const s = await seedReview();
  await decideQuotes(s);
  await startJob(s.projectId, "appraisal", 7, { force: true });
  await settleJobs(s.projectId);
  assert.equal((await latestJob(s.projectId, 7)).status, "done");
  const apps = await db.select().from(schema.appraisals).where(inArray(schema.appraisals.paperId, s.paperIds)).all();
  assert.equal(apps.length, 4);
  assert.ok(apps.every((a) => a.status === "done" && !s.appraisalIds.includes(a.id)), "every appraisal was redone");
  assert.deepEqual(await decisions(s.projectId), []);
  const log = await logged(s.projectId, "appraisal_decisions_replaced");
  assert.equal(log.length, 1);
  assert.deepEqual(
    (log[0].before as { paperId: string; decision: string; quote: string }[]).map((x) => [x.paperId, x.decision, x.quote]).sort(),
    [[s.paperIds[0], "accepted", "poor connectivity limited video visits"], [s.paperIds[1], "rejected", "poor connectivity limited video visits"]].sort(),
  );
});

test("a model call that throws before it starts frees its slot, so later calls fail too instead of waiting for ever", async () => {
  const run = limiter(2);
  const boom = () => {
    throw new Error("XAI_API_KEY is not set");
  };
  for (let i = 0; i < 5; i++) await assert.rejects(run(boom as () => Promise<void>), /XAI_API_KEY is not set/);
  assert.equal(await run(async () => "ran"), "ran");
});

test("the Re-run control says what a full re-run of summaries and appraisals replaces", () => {
  assert.match(RERUN_REPLACES[5], /replaces every existing summary, including cells you corrected/);
  assert.match(RERUN_REPLACES[5], /Retry missing summaries/);
  assert.match(RERUN_REPLACES[7], /replaces the existing ones, including your accept\/reject decisions and edited statements/);
  for (const st of STAGES.filter((x) => x.job)) assert.ok(RERUN_REPLACES[st.n], `stage ${st.n} has a re-run note`);
});
